import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { buildItemInsertRows, computeReplaceItems, type ExistingItem, type MenuRef } from '@/lib/transactions';
import {
  buildAppliedChipsSnapshot,
  validateChipMutex,
  fetchChipsByMenu,
} from '@/lib/menu-chips';
import { newEvent, tagStatus, type RequestEvent } from '@/lib/logger';
import { computeNextDailySeq } from '@/lib/daily-seq';
import { businessDate, businessDayRange } from '@/lib/date';
import { buildPaidUpdate } from '@/lib/monitor';

const STORAGE_BUCKET = 'notas';
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const NOT_FOUND_CODE = 'PGRST116';

const PatchSchema = z.object({
  status: z.enum(['pending_review', 'confirmed']).optional(),
  customer_name: z.string().nullable().optional(),
  table_no: z.string().nullable().optional(),
  handwritten_total: z.number().int().nonnegative().nullable().optional(),
  is_takeaway: z.boolean().optional(),
  paid: z.boolean().optional(),
  items: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        menu_id: z.string().uuid(),
        qty: z.number().int().positive(),
        notes: z.string().nullable().default(null),
        chip_labels: z.array(z.string().min(1).max(40)).max(20).default([]),
        sort_order: z.number().int().default(0),
        confidence: z.number().int().min(0).max(100).nullable().optional(),
      })
    )
    .optional(),
}).strict();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const evt = newEvent('GET /api/transactions/[id]', { tx_id: id });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const { data: tx, error: txError } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .single();
    if (txError) {
      if (txError.code === NOT_FOUND_CODE) {
        tagStatus(evt, 404);
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
      tagStatus(evt, 500);
      evt.error(txError);
      return NextResponse.json({ error: txError.message }, { status: 500 });
    }

    const { data: items, error: itemsError } = await supabase
      .from('transaction_items')
      .select('*, menus(category)')
      .eq('transaction_id', id)
      .order('sort_order');
    if (itemsError) {
      tagStatus(evt, 500);
      evt.error(itemsError);
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    let scan_url: string | null = null;
    if (tx.scan_image_path) {
      const { data: signed } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(tx.scan_image_path, SIGNED_URL_TTL_SECONDS);
      scan_url = signed?.signedUrl ?? null;
    }

    evt.merge({
      tx_status: tx.status,
      items_count: items?.length ?? 0,
      has_scan_url: !!scan_url,
    });
    tagStatus(evt, 200);
    return NextResponse.json({ transaction: tx, items: items ?? [], scan_url });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const evt = newEvent('PATCH /api/transactions/[id]', { tx_id: id });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const body = await request.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ reject_reason: 'invalid_body', zod_issues: parsed.error.issues });
      return NextResponse.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 });
    }
    evt.merge({
      patch_status: parsed.data.status ?? null,
      patch_items_count: parsed.data.items?.length ?? null,
      patch_set_customer_name: parsed.data.customer_name !== undefined,
      patch_set_table_no: parsed.data.table_no !== undefined,
      patch_set_handwritten_total: parsed.data.handwritten_total !== undefined,
      patch_set_is_takeaway: parsed.data.is_takeaway ?? null,
      patch_set_paid: parsed.data.paid ?? null,
    });

    const headerStatus = await applyHeaderUpdate(supabase, id, parsed.data, evt);
    if (headerStatus.kind === 'error') return headerStatus.response;

    if (parsed.data.items !== undefined) {
      const itemsStatus = await replaceItems(supabase, id, parsed.data.items, evt);
      if (itemsStatus.kind === 'error') return itemsStatus.response;
    }

    const { data: finalTx } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', id)
      .single();
    const { data: finalItems } = await supabase
      .from('transaction_items')
      .select('*')
      .eq('transaction_id', id)
      .order('sort_order');

    evt.merge({
      final_status: finalTx?.status,
      final_items_count: finalItems?.length ?? 0,
    });
    tagStatus(evt, 200);
    return NextResponse.json({ transaction: finalTx, items: finalItems ?? [] });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}

type StepResult =
  | { kind: 'ok' }
  | { kind: 'error'; response: NextResponse };

type SupabaseLike = Awaited<ReturnType<typeof getSupabaseServer>>;

async function applyHeaderUpdate(
  supabase: SupabaseLike,
  id: string,
  patch: z.infer<typeof PatchSchema>,
  evt: RequestEvent
): Promise<StepResult> {
  const headerUpdate: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    headerUpdate.status = patch.status;
    if (patch.status === 'confirmed') {
      // Only set confirmed_at on transition. If the read fails (network blip, RLS), don't
      // touch confirmed_at — better to leave it stale than risk overwriting the original.
      const { data: existing, error: readErr } = await supabase
        .from('transactions')
        .select('confirmed_at, status')
        .eq('id', id)
        .single();
      if (readErr) {
        tagStatus(evt, 500);
        evt.error(readErr);
        return { kind: 'error', response: NextResponse.json({ error: readErr.message }, { status: 500 }) };
      }
      if (!existing?.confirmed_at) {
        headerUpdate.confirmed_at = new Date().toISOString();
      }

      // — TAMBAHAN: generate daily_seq saat status berubah ke 'confirmed' —
      // Hanya pada transisi pending_review → confirmed (bukan re-confirm).
      // Business-day basis: pakai tanggal saat ini, bukan created_at lama,
      // karena daily_seq cerminkan urutan confirm hari ini.
      const isConfirming = existing?.status !== 'confirmed';
      if (isConfirming) {
        const ymd = businessDate(new Date());
        const { start, end } = businessDayRange(ymd);

        const { data: sameDayTxs, error: queryErr } = await supabase
          .from('transactions')
          .select('daily_seq')
          .eq('status', 'confirmed')
          .is('deleted_at', null)
          .gte('created_at', start)
          .lt('created_at', end);

        if (queryErr) {
          tagStatus(evt, 500);
          evt.error(queryErr);
          return { kind: 'error', response: NextResponse.json({ error: queryErr.message }, { status: 500 }) };
        }

        const existingSeqs = (sameDayTxs ?? []).map(
          (r) => r.daily_seq as number | null
        );
        const dailySeqToSet = computeNextDailySeq(existingSeqs);
        headerUpdate.daily_seq = dailySeqToSet;
        evt.set('daily_seq_assigned', dailySeqToSet);
      }
    }
  }
  if (patch.customer_name !== undefined) headerUpdate.customer_name = patch.customer_name;
  if (patch.table_no !== undefined) headerUpdate.table_no = patch.table_no;
  if (patch.handwritten_total !== undefined) {
    headerUpdate.handwritten_total = patch.handwritten_total;
    evt.set('total_changed', true);
  }
  if (patch.is_takeaway !== undefined) headerUpdate.is_takeaway = patch.is_takeaway;
  if (patch.paid !== undefined) {
    const { paid_at } = buildPaidUpdate(patch.paid, new Date().toISOString());
    headerUpdate.paid_at = paid_at;
    evt.set('paid_set', patch.paid);
  }

  if (Object.keys(headerUpdate).length === 0) return { kind: 'ok' };

  const { error: updateError } = await supabase
    .from('transactions')
    .update(headerUpdate)
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .single();

  if (updateError) {
    if (updateError.code === NOT_FOUND_CODE) {
      tagStatus(evt, 404);
      return { kind: 'error', response: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
    }
    tagStatus(evt, 500);
    evt.error(updateError);
    return { kind: 'error', response: NextResponse.json({ error: updateError.message }, { status: 500 }) };
  }
  return { kind: 'ok' };
}

async function replaceItems(
  supabase: SupabaseLike,
  id: string,
  requestedItems: NonNullable<z.infer<typeof PatchSchema>['items']>,
  evt: RequestEvent
): Promise<StepResult> {
  const { data: existingItems, error: existingError } = await supabase
    .from('transaction_items')
    .select('id, menu_id, unit_price_snapshot, qty, notes, applied_chips, sort_order, printed_dapur_at, printed_minuman_at')
    .eq('transaction_id', id);
  if (existingError) {
    tagStatus(evt, 500);
    evt.error(existingError);
    return { kind: 'error', response: NextResponse.json({ error: existingError.message }, { status: 500 }) };
  }

  const { data: menusData, error: menusError } = await supabase
    .from('menus')
    .select('id, name, price');
  if (menusError || !menusData) {
    tagStatus(evt, 500);
    evt.set('reject_reason', 'menu_fetch_failed').error(menusError);
    return { kind: 'error', response: NextResponse.json({ error: 'menu_fetch_failed' }, { status: 500 }) };
  }

  // Fetch chips only for referenced menus (avoid full-table scan).
  const menuIds = Array.from(new Set(requestedItems.map((r) => r.menu_id)));
  let chipsByMenu;
  try {
    chipsByMenu = await fetchChipsByMenu(supabase, menuIds);
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    return {
      kind: 'error',
      response: NextResponse.json(
        { error: err instanceof Error ? err.message : 'chip_fetch_failed' },
        { status: 500 },
      ),
    };
  }

  // Snapshot chip_labels → applied_chips per item.
  let resolvedItems;
  try {
    resolvedItems = requestedItems.map((item) => {
      const available = chipsByMenu.get(item.menu_id) ?? [];
      validateChipMutex(item.chip_labels, available);
      const applied = buildAppliedChipsSnapshot(item.chip_labels, available);
      return {
        ...item,
        applied_chips: applied,
      };
    });
  } catch (err) {
    tagStatus(evt, 400);
    evt.set('reject_reason', 'chip_validation_failed').error(err);
    return {
      kind: 'error',
      response: NextResponse.json(
        { error: 'chip_validation_failed', details: err instanceof Error ? err.message : 'unknown' },
        { status: 400 },
      ),
    };
  }

  let computed;
  try {
    computed = computeReplaceItems({
      existing: (existingItems ?? []) as ExistingItem[],
      requested: resolvedItems,
      menus: menusData as MenuRef[],
    });
  } catch (err) {
    tagStatus(evt, 400);
    evt.set('reject_reason', 'invalid_items').error(err);
    return {
      kind: 'error',
      response: NextResponse.json(
        { error: 'invalid_items', details: err instanceof Error ? err.message : 'unknown' },
        { status: 400 }
      ),
    };
  }

  evt.merge({
    items_existing_count: existingItems?.length ?? 0,
    items_computed_count: computed.rows.length,
  });

  const { error: deleteError } = await supabase
    .from('transaction_items')
    .delete()
    .eq('transaction_id', id);
  if (deleteError) {
    tagStatus(evt, 500);
    evt.error(deleteError);
    return { kind: 'error', response: NextResponse.json({ error: deleteError.message }, { status: 500 }) };
  }

  if (computed.rows.length > 0) {
    const insertRows = buildItemInsertRows(computed.rows, id);
    // defaultToNull: false — supaya supabase-js TIDAK set columns= query param,
    // sehingga row tanpa `id` (item baru) di-handle PostgREST pakai DEFAULT
    // gen_random_uuid() instead of NULL (kena NOT NULL constraint). Lihat
    // buildItemInsertRows comment + PostgREST bulk insert docs.
    const { error: insertError } = await supabase
      .from('transaction_items')
      .insert(insertRows, { defaultToNull: false });
    if (insertError) {
      tagStatus(evt, 500);
      evt.error(insertError);
      return { kind: 'error', response: NextResponse.json({ error: insertError.message }, { status: 500 }) };
    }
  }
  return { kind: 'ok' };
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const evt = newEvent('DELETE /api/transactions/[id]', { tx_id: id });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const { error } = await supabase
      .from('transactions')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
      .single();

    if (error) {
      if (error.code === NOT_FOUND_CODE) {
        tagStatus(evt, 404);
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    tagStatus(evt, 200);
    return NextResponse.json({ ok: true });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
