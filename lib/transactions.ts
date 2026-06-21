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
  sort_order: number;
};

export type RequestedItem = {
  id?: string;
  menu_id: string;
  qty: number;
  notes: string | null;
  sort_order: number;
};

export type ItemRow = {
  menu_id: string;
  menu_name_snapshot: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  sort_order: number;
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
 *
 * Item existing yang tidak disebut di requested = effective delete (dilakukan dengan
 * DELETE all + INSERT new di caller).
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
      menu_id: menu.id,
      menu_name_snapshot: menu.name,
      unit_price_snapshot,
      qty: req.qty,
      notes: req.notes,
      sort_order: req.sort_order,
    };
  });

  return { rows };
}
