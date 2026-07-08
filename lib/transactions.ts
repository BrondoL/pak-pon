import type { AppliedChip } from './menu-chips';

export type MenuRef = {
  id: string;
  name: string;
  price: number;
};

export type ExistingItem = {
  id: string;
  menu_id: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  applied_chips: AppliedChip[];
  sort_order: number;
  printed_dapur_at: string | null;
  printed_minuman_at: string | null;
};

export type RequestedItem = {
  id?: string;
  menu_id: string;
  qty: number;
  notes: string | null;
  applied_chips?: AppliedChip[];
  sort_order: number;
  confidence?: number | null;
};

export type ItemRow = {
  // id present hanya untuk items yang preserved dari existing — supaya
  // delete+insert tetap reuse UUID lama dan trigger Postgres tidak salah baca.
  id?: string;
  menu_id: string;
  menu_name_snapshot: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  applied_chips: AppliedChip[];
  sort_order: number;
  confidence: number | null;
  // Carry forward print-tracking flags supaya "Cetak tambahan" tahu mana yang
  // sudah dicetak. Null untuk item baru (akan diset oleh trigger saat job done).
  printed_dapur_at: string | null;
  printed_minuman_at: string | null;
};

export type ReplaceItemsResult = {
  rows: ItemRow[];
};

/**
 * Build insert payload supaya:
 * - Item baru (id undefined): kolom `id` di-strip → Postgres pakai DEFAULT gen_random_uuid()
 * - Item preserved (id string): kolom `id` di-include → flag tracking via trigger jalan
 *
 * Penting: undefined kalau di-spread literal ke insert → Supabase client serialize jadi
 * null → kena NOT NULL constraint di transaction_items.id.
 */
export function buildItemInsertRows(
  rows: ItemRow[],
  transactionId: string,
): Array<Record<string, unknown>> {
  return rows.map((r) => {
    const { id: rowId, ...rest } = r;
    const base: Record<string, unknown> = { ...rest, transaction_id: transactionId };
    if (typeof rowId === 'string' && rowId.length > 0) {
      base.id = rowId;
    }
    return base;
  });
}

/**
 * Compute rows untuk "replace items" PATCH transaksi.
 *
 * Untuk setiap requested item:
 * - Kalau punya `id` yang cocok dengan existing DAN applied_chips tidak berubah
 *   → preserve `unit_price_snapshot` lama (frozen at create time)
 * - Kalau id cocok tapi chips berubah (kasir toggle chip) → recompute
 *   = menu.price + sum(chip.price_delta)
 * - Kalau no `id` atau id tidak cocok → snapshot harga sekarang dari menus
 *   + chip delta sum
 * - `applied_chips` default ke [] kalau tidak dikirim (backward-compat pre-chip)
 * - confidence di-passthrough apa adanya (default null kalau tidak dikirim)
 *
 * Throw kalau ada requested item dengan menu_id yang tidak ada di menus.
 */
export function computeReplaceItems(input: {
  existing: ExistingItem[];
  requested: RequestedItem[];
  menus: MenuRef[];
}): ReplaceItemsResult {
  const existingById = new Map(input.existing.map((e) => [e.id, e]));
  const menuById = new Map(input.menus.map((m) => [m.id, m]));

  const rows: ItemRow[] = input.requested.map((req) => {
    const menu = menuById.get(req.menu_id);
    if (!menu) {
      throw new Error(`Unknown menu_id: ${req.menu_id}`);
    }

    const matchedExisting = req.id ? existingById.get(req.id) : undefined;
    const applied_chips = req.applied_chips ?? [];

    // Unit price snapshot: preserve frozen existing snapshot UNLESS chip
    // selection changed (kasir toggle chip on existing item). If chips
    // changed OR item is new, recompute = menu.price + sum(chip.price_delta).
    const existingChipsKey = matchedExisting
      ? matchedExisting.applied_chips.map((c) => c.label).sort().join('|')
      : '';
    const requestedChipsKey = applied_chips.map((c) => c.label).sort().join('|');
    const chipsChanged = existingChipsKey !== requestedChipsKey;

    const chipDeltaSum = applied_chips.reduce((s, c) => s + c.price_delta, 0);
    const unit_price_snapshot =
      matchedExisting && !chipsChanged
        ? matchedExisting.unit_price_snapshot
        : menu.price + chipDeltaSum;

    return {
      // Preserve id supaya printed_*_at di trigger Postgres tetap match item
      // yang sama. Item baru (no match) tidak punya id — DB akan generate.
      id: matchedExisting?.id,
      menu_id: menu.id,
      menu_name_snapshot: menu.name,
      unit_price_snapshot,
      qty: req.qty,
      notes: req.notes,
      applied_chips,
      sort_order: req.sort_order,
      confidence: req.confidence ?? null,
      printed_dapur_at: matchedExisting?.printed_dapur_at ?? null,
      printed_minuman_at: matchedExisting?.printed_minuman_at ?? null,
    };
  });

  return { rows };
}
