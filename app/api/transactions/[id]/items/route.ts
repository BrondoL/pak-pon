import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import {
  buildAppendItemRows,
  buildItemInsertRows,
  type AppendItemRequest,
  type MenuRef,
} from '@/lib/transactions';
import {
  buildAppliedChipsSnapshot,
  validateChipMutex,
  fetchChipsByMenu,
} from '@/lib/menu-chips';

const NOT_FOUND_CODE = 'PGRST116';

const AppendItemsSchema = z
  .object({
    items: z
      .array(
        z.object({
          menu_id: z.string().uuid(),
          qty: z.number().int().positive().max(99),
          chip_labels: z.array(z.string().min(1).max(40)).max(20).default([]),
          notes: z.string().max(200).nullable().default(null),
        }),
      )
      .min(1)
      .max(50),
  })
  .strict();

/**
 * Append-only: tambah item ke transaksi confirmed yang sudah jalan.
 *
 * Sengaja BUKAN PATCH /api/transactions/[id] — route itu delete-all + insert
 * ulang seluruh item, jadi client harus mengirim balik daftar item lama yang
 * bisa saja sudah basi (device lain menambah item di sela GET→PATCH → item itu
 * terhapus). Di sini server cuma INSERT: baris lama tidak pernah tersentuh,
 * printed_dapur_at/printed_minuman_at-nya utuh, tiket dapur mustahil dobel.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const evt = newEvent('POST /api/transactions/[id]/items');
  const startedAt = Date.now();
  try {
    const { id } = await params;
    evt.set('tx_id', id);

    const supabase = await getSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const body = await request.json();
    const parsed = AppendItemsSchema.safeParse(body);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ reject_reason: 'invalid_body', zod_issues: parsed.error.issues });
      return NextResponse.json(
        { error: 'invalid_body', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const payload = parsed.data;

    // 1. Transaksi harus ada & belum dihapus.
    const { data: tx, error: txErr } = await supabase
      .from('transactions')
      .select('id, status, daily_seq, created_at, customer_name, table_no, is_takeaway')
      .eq('id', id)
      .is('deleted_at', null)
      .single();
    if (txErr) {
      if (txErr.code === NOT_FOUND_CODE) {
        tagStatus(evt, 404);
        evt.set('reject_reason', 'not_found');
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
      tagStatus(evt, 500);
      evt.error(txErr);
      return NextResponse.json({ error: txErr.message }, { status: 500 });
    }

    // 2. Monitor cuma menampilkan confirmed. 409 menangkap transaksi yang
    //    keburu berubah status dari device lain saat modal terbuka.
    if (tx.status !== 'confirmed') {
      tagStatus(evt, 409);
      evt.merge({ reject_reason: 'not_confirmed', tx_status: tx.status });
      return NextResponse.json({ error: 'not_confirmed' }, { status: 409 });
    }

    // 3. Master menu untuk menu_id yang dikirim saja.
    const menuIds = Array.from(new Set(payload.items.map((i) => i.menu_id)));
    const { data: menusData, error: menusErr } = await supabase
      .from('menus')
      .select('id, name, price')
      .in('id', menuIds);
    if (menusErr) {
      tagStatus(evt, 500);
      evt.error(menusErr);
      return NextResponse.json({ error: menusErr.message }, { status: 500 });
    }
    const menus = (menusData ?? []) as MenuRef[];
    const menuById = new Map(menus.map((m) => [m.id, m]));
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

    // 4. Chip master → snapshot server-side (client cuma kirim label).
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

    const requested: AppendItemRequest[] = [];
    let totalChipCount = 0;
    let hasFreeNotes = false;
    for (const [idx, item] of payload.items.entries()) {
      const availableChips = chipsByMenu.get(item.menu_id) ?? [];
      try {
        validateChipMutex(item.chip_labels, availableChips);
      } catch (err) {
        tagStatus(evt, 400);
        evt.merge({ reject_reason: 'chip_mutex_violation', item_index: idx });
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
        evt.merge({ reject_reason: 'unknown_chip_label', item_index: idx });
        return NextResponse.json(
          { error: 'unknown_chip_label', details: err instanceof Error ? err.message : 'unknown' },
          { status: 400 },
        );
      }
      totalChipCount += applied.length;
      if (item.notes && item.notes.trim().length > 0) hasFreeNotes = true;
      requested.push({
        menu_id: item.menu_id,
        qty: item.qty,
        notes: item.notes,
        applied_chips: applied,
      });
    }

    // 5. sort_order lanjut dari item terakhir supaya item baru di urutan bawah.
    const { data: lastItem, error: lastErr } = await supabase
      .from('transaction_items')
      .select('sort_order')
      .eq('transaction_id', id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastErr) {
      tagStatus(evt, 500);
      evt.error(lastErr);
      return NextResponse.json({ error: lastErr.message }, { status: 500 });
    }
    const startSortOrder = lastItem ? (lastItem.sort_order as number) + 1 : 0;

    // 6. Insert. buildItemInsertRows membuang key `id` yang undefined —
    //    kalau di-spread mentah, Supabase serialize jadi null → kena NOT NULL.
    const rows = buildAppendItemRows({ requested, menus, startSortOrder });
    const insertRows = buildItemInsertRows(rows, id);
    const { data: itemsCreated, error: itemsErr } = await supabase
      .from('transaction_items')
      .insert(insertRows, { defaultToNull: false })
      .select();
    if (itemsErr) {
      tagStatus(evt, 500);
      evt.error(itemsErr);
      return NextResponse.json({ error: itemsErr.message }, { status: 500 });
    }

    evt.merge({
      item_count: rows.length,
      chip_count: totalChipCount,
      has_free_notes: hasFreeNotes,
      added_amount: rows.reduce((s, r) => s + r.unit_price_snapshot * r.qty, 0),
      start_sort_order: startSortOrder,
      elapsed_ms: Date.now() - startedAt,
    });
    tagStatus(evt, 201);
    return NextResponse.json({ transaction: tx, items: itemsCreated ?? [] }, { status: 201 });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
