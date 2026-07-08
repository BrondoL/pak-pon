'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { formatRp } from '@/lib/currency';
import type { MenuOption } from '@/components/nota-item-modal';

export type PosCartItemDraft = {
  menu_id: string;
  menu_name_snapshot: string;
  category: MenuOption['category'];
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  applied_chips: Array<{ label: string; price_delta: number }>;
};

export function PosItemConfigModal({
  menu,
  initial,
  onSave,
  onClose,
}: {
  menu: MenuOption;
  initial?: PosCartItemDraft;
  onSave: (item: PosCartItemDraft) => void;
  onClose: () => void;
}) {
  const [qty, setQty] = useState(initial?.qty ?? 1);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [selectedChipLabels, setSelectedChipLabels] = useState<string[]>(
    initial?.applied_chips?.map((c) => c.label) ?? []
  );

  const chipDelta = useMemo(() => {
    return menu.chips
      .filter((c) => selectedChipLabels.includes(c.label))
      .reduce((sum, c) => sum + c.price_delta, 0);
  }, [menu, selectedChipLabels]);

  const effectiveUnitPrice = menu.price + chipDelta;

  const groups = useMemo(() => {
    const mutex = new Map<string, typeof menu.chips>();
    const free: typeof menu.chips = [];
    for (const c of menu.chips) {
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
  }, [menu]);

  function toggleFreeChip(label: string) {
    setSelectedChipLabels((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  }
  function pickMutexChip(groupChips: typeof menu.chips, label: string) {
    const groupLabels = new Set(groupChips.map((c) => c.label));
    setSelectedChipLabels((prev) => {
      const without = prev.filter((l) => !groupLabels.has(l));
      return prev.includes(label) ? without : [...without, label];
    });
  }
  function renderChip(label: string, priceDelta: number, isSelected: boolean, onClick: () => void) {
    const display = priceDelta > 0 ? `${label} +${Math.round(priceDelta / 1000)}k` : label;
    return (
      <button
        key={label}
        type="button"
        onClick={onClick}
        className={[
          'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
          isSelected ? 'border-coal bg-coal text-paper' : 'border-clay-soft bg-paper-soft text-coal hover:bg-cream',
        ].join(' ')}
      >
        {display}
      </button>
    );
  }

  function handleSave() {
    if (qty < 1) return;
    const applied_chips = menu.chips
      .filter((c) => selectedChipLabels.includes(c.label))
      .map((c) => ({ label: c.label, price_delta: c.price_delta }));
    onSave({
      menu_id: menu.id,
      menu_name_snapshot: menu.name,
      category: menu.category,
      unit_price_snapshot: effectiveUnitPrice,
      qty,
      notes: notes.trim() === '' ? null : notes.trim(),
      applied_chips,
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{menu.name} — {formatRp(menu.price)}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="pos-qty">Jumlah</Label>
            <div className="mt-2 flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</Button>
              <Input id="pos-qty" type="number" min={1} value={qty}
                onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                className="w-20 text-center font-display" />
              <Button type="button" variant="secondary" size="sm" onClick={() => setQty((q) => q + 1)}>+</Button>
              <span className="ml-auto font-display text-lg text-coal">
                {formatRp(effectiveUnitPrice * qty)}
              </span>
            </div>
          </div>

          {groups.mutexSections.map((section) => (
            <div key={section.name}>
              <Label className="mb-2 block text-xs uppercase tracking-wide text-clay">
                {section.name} (pilih satu)
              </Label>
              <div className="flex flex-wrap gap-2">
                {section.list.map((c) =>
                  renderChip(c.label, c.price_delta, selectedChipLabels.includes(c.label), () => pickMutexChip(section.list, c.label))
                )}
              </div>
            </div>
          ))}
          {groups.free.length > 0 && (
            <div>
              <Label className="mb-2 block text-xs uppercase tracking-wide text-clay">Pilihan cepat</Label>
              <div className="flex flex-wrap gap-2">
                {groups.free.map((c) =>
                  renderChip(c.label, c.price_delta, selectedChipLabels.includes(c.label), () => toggleFreeChip(c.label))
                )}
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="pos-notes">Catatan tambahan (opsional)</Label>
            <Input id="pos-notes" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="cth: pisah nasinya, jangan garing" className="mt-2" />
          </div>
        </div>

        <DialogFooter className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} className="ml-auto">Batal</Button>
          <Button type="button" onClick={handleSave} disabled={qty < 1}>
            {initial ? 'Simpan' : '+ Tambah ke cart'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
