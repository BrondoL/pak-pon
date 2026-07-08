import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import { computeNextDailySeq } from '@/lib/daily-seq';
import { businessDate, businessDayRange } from '@/lib/date';
import {
  buildAppliedChipsSnapshot,
  validateChipMutex,
  sumChipPriceDeltas,
  fetchChipsByMenu,
} from '@/lib/menu-chips';
import { CreatePosTransactionSchema } from './_schemas';

export async function POST(request: NextRequest) {
  const evt = newEvent('POST /api/pos');
  const startedAt = Date.now();
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const body = await request.json();
    const parsed = CreatePosTransactionSchema.safeParse(body);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ reject_reason: 'invalid_body', zod_issues: parsed.error.issues });
      return NextResponse.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 });
    }
    const payload = parsed.data;

    // Fetch menus + chips for all items.
    const menuIds = Array.from(new Set(payload.items.map((i) => i.menu_id)));
    const { data: menusData, error: menusErr } = await supabase
      .from('menus')
      .select('id, name, price, category, is_active')
      .in('id', menuIds);
    if (menusErr) {
      tagStatus(evt, 500);
      evt.error(menusErr);
      return NextResponse.json({ error: menusErr.message }, { status: 500 });
    }
    const menuById = new Map((menusData ?? []).map((m) => [m.id, m]));
    for (const menuId of menuIds) {
      if (!menuById.has(menuId)) {
        tagStatus(evt, 400);
        evt.set('reject_reason', 'unknown_menu_id');
        return NextResponse.json(
          { error: 'unknown_menu_id', details: `Menu ${menuId} not found` },
          { status: 400 },
        );
      }
    }

    let chipsByMenu;
    try {
      chipsByMenu = await fetchChipsByMenu(supabase, menuIds);
    } catch (err) {
      tagStatus(evt, 500);
      evt.error(err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'chip_fetch_failed' },
        { status: 500 },
      );
    }

    // Snapshot + validate per item.
    const itemsForInsert: Array<{
      menu_id: string;
      menu_name_snapshot: string;
      unit_price_snapshot: number;
      qty: number;
      notes: string | null;
      applied_chips: Array<{ label: string; price_delta: number }>;
      sort_order: number;
      confidence: number | null;
    }> = [];
    let totalChipCount = 0;
    let hasFreeNotes = false;
    for (const [idx, item] of payload.items.entries()) {
      const menu = menuById.get(item.menu_id)!;
      const availableChips = chipsByMenu.get(item.menu_id) ?? [];
      try {
        validateChipMutex(item.chip_labels, availableChips);
      } catch (err) {
        tagStatus(evt, 400);
        evt.set('reject_reason', 'chip_mutex_violation').set('item_index', idx);
        return NextResponse.json(
          { error: 'chip_mutex_violation', details: err instanceof Error ? err.message : 'mutex' },
          { status: 400 },
        );
      }
      let applied;
      try {
        applied = buildAppliedChipsSnapshot(item.chip_labels, availableChips);
      } catch (err) {
        tagStatus(evt, 400);
        evt.set('reject_reason', 'unknown_chip_label').set('item_index', idx);
        return NextResponse.json(
          { error: 'unknown_chip_label', details: err instanceof Error ? err.message : 'unknown' },
          { status: 400 },
        );
      }
      totalChipCount += applied.length;
      if (item.notes && item.notes.trim().length > 0) hasFreeNotes = true;
      itemsForInsert.push({
        menu_id: menu.id,
        menu_name_snapshot: menu.name,
        unit_price_snapshot: menu.price + sumChipPriceDeltas(applied),
        qty: item.qty,
        notes: item.notes,
        applied_chips: applied,
        sort_order: item.sort_order ?? idx,
        confidence: null,
      });
    }

    // Compute daily_seq — pattern from PATCH transactions confirm.
    const now = new Date();
    const ymd = businessDate(now);
    const { start, end } = businessDayRange(ymd);
    const { data: sameDayTxs, error: seqErr } = await supabase
      .from('transactions')
      .select('daily_seq')
      .eq('status', 'confirmed')
      .is('deleted_at', null)
      .gte('created_at', start)
      .lt('created_at', end);
    if (seqErr) {
      tagStatus(evt, 500);
      evt.error(seqErr);
      return NextResponse.json({ error: seqErr.message }, { status: 500 });
    }
    const dailySeq = computeNextDailySeq((sameDayTxs ?? []).map((r) => r.daily_seq as number | null));

    // Insert transaction.
    const txId = randomUUID();
    const { data: txCreated, error: txErr } = await supabase
      .from('transactions')
      .insert({
        id: txId,
        status: 'confirmed',
        customer_name: payload.customer_name,
        table_no: payload.table_no,
        is_takeaway: payload.is_takeaway,
        confirmed_at: now.toISOString(),
        daily_seq: dailySeq,
        scan_image_path: null,
        handwritten_total: null,
      })
      .select()
      .single();
    if (txErr) {
      tagStatus(evt, 500);
      evt.error(txErr);
      return NextResponse.json({ error: txErr.message }, { status: 500 });
    }

    // Insert items.
    const insertRows = itemsForInsert.map((r) => ({
      ...r,
      transaction_id: txId,
    }));
    const { data: itemsCreated, error: itemsErr } = await supabase
      .from('transaction_items')
      .insert(insertRows, { defaultToNull: false })
      .select('*, menus(category)');
    if (itemsErr) {
      tagStatus(evt, 500);
      evt.error(itemsErr);
      return NextResponse.json({ error: itemsErr.message }, { status: 500 });
    }

    const totalAmount = itemsForInsert.reduce((s, r) => s + r.unit_price_snapshot * r.qty, 0);
    evt.merge({
      tx_id: txId,
      item_count: itemsForInsert.length,
      total_amount: totalAmount,
      chip_count: totalChipCount,
      is_takeaway: payload.is_takeaway,
      has_free_notes: hasFreeNotes,
      daily_seq_assigned: dailySeq,
      elapsed_ms: Date.now() - startedAt,
    });
    tagStatus(evt, 201);
    return NextResponse.json({ transaction: txCreated, items: itemsCreated ?? [] }, { status: 201 });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
