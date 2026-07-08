export type MenuChip = {
  id: string;
  menu_id: string;
  label: string;
  price_delta: number;
  mutex_group: string | null;
  sort_order: number;
};

/**
 * Minimal shape of the Supabase client used by chip fetch helpers. Kept as
 * `unknown`-friendly `any` so any client returned by `getSupabaseServer()` /
 * `getSupabaseAdmin()` satisfies it — full generic parameters trip the
 * PostgREST query-builder inference (TS2589: excessively deep). Runtime shape
 * still enforced by the query below.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientLike = any;

/**
 * Fetch chips for a set of menus and group them by menu id. Throws on DB error
 * so the caller can log via its wide-event handler + return an appropriate
 * error response. Empty `menuIds` returns an empty map without hitting the DB.
 */
export async function fetchChipsByMenu(
  supabase: SupabaseClientLike,
  menuIds: string[],
): Promise<Map<string, MenuChip[]>> {
  const byMenu = new Map<string, MenuChip[]>();
  if (menuIds.length === 0) return byMenu;
  const { data, error } = await supabase
    .from('menu_chips')
    .select('id, menu_id, label, price_delta, mutex_group, sort_order')
    .in('menu_id', menuIds);
  if (error) throw new Error(error.message);
  for (const c of (data ?? []) as MenuChip[]) {
    const list = byMenu.get(c.menu_id) ?? [];
    list.push(c);
    byMenu.set(c.menu_id, list);
  }
  return byMenu;
}

export type AppliedChip = {
  label: string;
  price_delta: number;
};

export function buildAppliedChipsSnapshot(
  chipLabels: string[],
  availableChips: MenuChip[],
): AppliedChip[] {
  const byLabel = new Map(availableChips.map((c) => [c.label, c]));
  return chipLabels.map((label) => {
    const chip = byLabel.get(label);
    if (!chip) {
      throw new Error(`Unknown chip label: ${label}`);
    }
    return { label: chip.label, price_delta: chip.price_delta };
  });
}

export function validateChipMutex(
  chipLabels: string[],
  availableChips: MenuChip[],
): void {
  const byLabel = new Map(availableChips.map((c) => [c.label, c]));
  const seenGroups = new Map<string, string>();
  for (const label of chipLabels) {
    const chip = byLabel.get(label);
    if (!chip || !chip.mutex_group) continue;
    const prev = seenGroups.get(chip.mutex_group);
    if (prev) {
      throw new Error(
        `Mutex violation in group "${chip.mutex_group}": "${prev}" and "${label}" cannot coexist`,
      );
    }
    seenGroups.set(chip.mutex_group, label);
  }
}

export function sumChipPriceDeltas(chips: AppliedChip[]): number {
  return chips.reduce((sum, c) => sum + c.price_delta, 0);
}
