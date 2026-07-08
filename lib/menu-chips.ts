export type MenuChip = {
  id: string;
  menu_id: string;
  label: string;
  price_delta: number;
  mutex_group: string | null;
  sort_order: number;
};

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
