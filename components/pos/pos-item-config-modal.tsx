'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { formatRp } from '@/lib/currency';
import { ChipPicker } from '@/components/chip-picker';
import type { MenuOption } from '@/components/nota-item-modal';
import type { PosCartItemDraft } from '@/lib/cart-draft';

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

          {menu.chips.length > 0 && (
            <ChipPicker
              chips={menu.chips}
              selectedLabels={selectedChipLabels}
              onChange={setSelectedChipLabels}
            />
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
