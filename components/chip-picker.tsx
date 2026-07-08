'use client';

import { useMemo } from 'react';
import { Label } from '@/components/ui/label';

export type ChipOption = {
  id: string;
  label: string;
  price_delta: number;
  mutex_group: string | null;
  sort_order: number;
};

/**
 * Shared chip picker used by both the OCR nota-item modal and the POS
 * item-config modal. Renders mutex groups first (single-select per group) then
 * free chips ("Pilihan cepat", multi-select) — sort order preserved.
 */
export function ChipPicker({
  chips,
  selectedLabels,
  onChange,
}: {
  chips: ChipOption[];
  selectedLabels: string[];
  onChange: (next: string[]) => void;
}) {
  const groups = useMemo(() => {
    const mutex = new Map<string, ChipOption[]>();
    const free: ChipOption[] = [];
    for (const c of chips) {
      if (c.mutex_group) {
        const arr = mutex.get(c.mutex_group) ?? [];
        arr.push(c);
        mutex.set(c.mutex_group, arr);
      } else {
        free.push(c);
      }
    }
    for (const arr of mutex.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
    free.sort((a, b) => a.sort_order - b.sort_order);
    const mutexSections = Array.from(mutex.entries())
      .map(([name, list]) => ({ name, list, minOrder: list[0]?.sort_order ?? 0 }))
      .sort((a, b) => a.minOrder - b.minOrder);
    return { mutexSections, free };
  }, [chips]);

  function toggleFreeChip(label: string) {
    onChange(
      selectedLabels.includes(label)
        ? selectedLabels.filter((l) => l !== label)
        : [...selectedLabels, label]
    );
  }

  function pickMutexChip(groupChips: ChipOption[], label: string) {
    const groupLabels = new Set(groupChips.map((c) => c.label));
    const withoutGroup = selectedLabels.filter((l) => !groupLabels.has(l));
    const isCurrentlySelected = selectedLabels.includes(label);
    onChange(isCurrentlySelected ? withoutGroup : [...withoutGroup, label]);
  }

  function renderChip(label: string, priceDelta: number, isSelected: boolean, onClick: () => void) {
    const displayLabel = priceDelta > 0 ? `${label} +${Math.round(priceDelta / 1000)}k` : label;
    return (
      <button
        key={label}
        type="button"
        onClick={onClick}
        className={[
          'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
          isSelected
            ? 'border-coal bg-coal text-paper'
            : 'border-clay-soft bg-paper-soft text-coal hover:bg-cream',
        ].join(' ')}
      >
        {displayLabel}
      </button>
    );
  }

  return (
    <div className="space-y-3">
      {groups.mutexSections.map((section) => (
        <div key={section.name}>
          <Label className="mb-2 block text-xs uppercase tracking-wide text-clay">
            {section.name} (pilih satu)
          </Label>
          <div className="flex flex-wrap gap-2">
            {section.list.map((c) =>
              renderChip(c.label, c.price_delta, selectedLabels.includes(c.label), () =>
                pickMutexChip(section.list, c.label)
              )
            )}
          </div>
        </div>
      ))}
      {groups.free.length > 0 && (
        <div>
          <Label className="mb-2 block text-xs uppercase tracking-wide text-clay">
            Pilihan cepat
          </Label>
          <div className="flex flex-wrap gap-2">
            {groups.free.map((c) =>
              renderChip(c.label, c.price_delta, selectedLabels.includes(c.label), () =>
                toggleFreeChip(c.label)
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
