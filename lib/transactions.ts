export type MenuRef = {
  id: string;
  name: string;
  price: number;
};

export type Alternative = {
  menu_name: string;
  confidence?: number;
};

export type ExistingItem = {
  id: string;
  menu_id: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  sort_order: number;
  printed_dapur_at: string | null;
  printed_minuman_at: string | null;
};

export type RequestedItem = {
  id?: string;
  menu_id: string;
  qty: number;
  notes: string | null;
  sort_order: number;
  confidence?: number | null;
  alternatives?: Alternative[];
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
  sort_order: number;
  confidence: number | null;
  alternatives: Alternative[] | null;
  // Carry forward print-tracking flags supaya "Cetak tambahan" tahu mana yang
  // sudah dicetak. Null untuk item baru (akan diset oleh trigger saat job done).
  printed_dapur_at: string | null;
  printed_minuman_at: string | null;
};

export type ReplaceItemsResult = {
  rows: ItemRow[];
};

/**
 * Compute rows untuk "replace items" PATCH transaksi.
 *
 * Untuk setiap requested item:
 * - Kalau punya `id` yang cocok dengan existing → preserve `unit_price_snapshot` lama
 * - Kalau no `id` atau id tidak cocok → snapshot harga sekarang dari menus
 * - confidence + alternatives di-passthrough apa adanya (default null kalau tidak dikirim)
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
    const unit_price_snapshot = matchedExisting?.unit_price_snapshot ?? menu.price;

    return {
      // Preserve id supaya printed_*_at di trigger Postgres tetap match item
      // yang sama. Item baru (no match) tidak punya id — DB akan generate.
      id: matchedExisting?.id,
      menu_id: menu.id,
      menu_name_snapshot: menu.name,
      unit_price_snapshot,
      qty: req.qty,
      notes: req.notes,
      sort_order: req.sort_order,
      confidence: req.confidence ?? null,
      alternatives: req.alternatives ?? null,
      printed_dapur_at: matchedExisting?.printed_dapur_at ?? null,
      printed_minuman_at: matchedExisting?.printed_minuman_at ?? null,
    };
  });

  return { rows };
}
