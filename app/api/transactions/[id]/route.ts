import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { computeReplaceItems, type ExistingItem, type MenuRef } from '@/lib/transactions';

const STORAGE_BUCKET = 'notas';
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const NOT_FOUND_CODE = 'PGRST116';

const PatchSchema = z.object({
  status: z.enum(['pending_review', 'confirmed']).optional(),
  customer_name: z.string().nullable().optional(),
  table_no: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        menu_id: z.string().uuid(),
        qty: z.number().int().positive(),
        notes: z.string().nullable().default(null),
        sort_order: z.number().int().default(0),
      })
    )
    .optional(),
}).strict();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  console.log(`[tx] GET /api/transactions/${id}`);
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: tx, error: txError } = await supabase
    .from('transactions')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single();
  if (txError) {
    if (txError.code === NOT_FOUND_CODE) {
      console.warn(`[tx] GET ${id} → not_found`);
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    console.error(`[tx] GET ${id} → tx fetch error:`, txError);
    return NextResponse.json({ error: txError.message }, { status: 500 });
  }

  const { data: items, error: itemsError } = await supabase
    .from('transaction_items')
    .select('*')
    .eq('transaction_id', id)
    .order('sort_order');
  if (itemsError) {
    console.error(`[tx] GET ${id} → items fetch error:`, itemsError);
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  let scan_url: string | null = null;
  if (tx.scan_image_path) {
    const { data: signed } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(tx.scan_image_path, SIGNED_URL_TTL_SECONDS);
    scan_url = signed?.signedUrl ?? null;
  }
  console.log(`[tx] GET ${id} → tx.status=${tx.status}, items=${items?.length ?? 0}, scan_url=${scan_url ? 'yes' : 'no'}`);

  return NextResponse.json({
    transaction: tx,
    items: items ?? [],
    scan_url,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  console.log(`[tx] PATCH /api/transactions/${id}`);
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    console.warn(`[tx] PATCH ${id} → invalid_body:`, JSON.stringify(parsed.error.flatten()));
    return NextResponse.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 });
  }
  console.log(`[tx] PATCH ${id} body: status=${parsed.data.status}, items=${parsed.data.items?.length ?? 'none'}`);

  const headerUpdate: Record<string, unknown> = {};
  if (parsed.data.status !== undefined) {
    headerUpdate.status = parsed.data.status;
    if (parsed.data.status === 'confirmed') {
      headerUpdate.confirmed_at = new Date().toISOString();
    }
  }
  if (parsed.data.customer_name !== undefined) headerUpdate.customer_name = parsed.data.customer_name;
  if (parsed.data.table_no !== undefined) headerUpdate.table_no = parsed.data.table_no;

  if (Object.keys(headerUpdate).length > 0) {
    const { error: updateError } = await supabase
      .from('transactions')
      .update(headerUpdate)
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
      .single();
    if (updateError) {
      if (updateError.code === NOT_FOUND_CODE) {
        console.warn(`[tx] PATCH ${id} → not_found on header update`);
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
      console.error(`[tx] PATCH ${id} → header update error:`, updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    console.log(`[tx] PATCH ${id} → header updated`);
  }

  if (parsed.data.items !== undefined) {
    const { data: existingItems, error: existingError } = await supabase
      .from('transaction_items')
      .select('id, menu_id, unit_price_snapshot, qty, notes, sort_order')
      .eq('transaction_id', id);
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    const { data: menusData, error: menusError } = await supabase
      .from('menus')
      .select('id, name, price');
    if (menusError || !menusData) {
      return NextResponse.json({ error: 'menu_fetch_failed' }, { status: 500 });
    }

    let computed;
    try {
      computed = computeReplaceItems({
        existing: (existingItems ?? []) as ExistingItem[],
        requested: parsed.data.items,
        menus: menusData as MenuRef[],
      });
    } catch (err) {
      console.warn(`[tx] PATCH ${id} → invalid_items:`, err instanceof Error ? err.message : err);
      return NextResponse.json(
        { error: 'invalid_items', details: err instanceof Error ? err.message : 'unknown' },
        { status: 400 }
      );
    }
    console.log(`[tx] PATCH ${id} → computed ${computed.rows.length} rows (from ${existingItems?.length ?? 0} existing)`);

    const { error: deleteError } = await supabase
      .from('transaction_items')
      .delete()
      .eq('transaction_id', id);
    if (deleteError) {
      console.error(`[tx] PATCH ${id} → delete existing items error:`, deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    if (computed.rows.length > 0) {
      const insertRows = computed.rows.map((r) => ({ ...r, transaction_id: id }));
      const { error: insertError } = await supabase
        .from('transaction_items')
        .insert(insertRows);
      if (insertError) {
        console.error(`[tx] PATCH ${id} → insert new items error:`, insertError);
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }
    console.log(`[tx] PATCH ${id} → items replaced (${computed.rows.length} new)`);
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

  return NextResponse.json({ transaction: finalTx, items: finalItems ?? [] });
}
