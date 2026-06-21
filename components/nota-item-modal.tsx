'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { formatRp } from '@/lib/currency';
import type { NotaItem } from './nota-item-row';

export type MenuOption = {
  id: string;
  name: string;
  category: 'makanan' | 'nasi' | 'minuman';
  price: number;
};

export function NotaItemModal({
  initial,
  menus,
  onSave,
  onClose,
  onDelete,
}: {
  initial?: NotaItem;
  menus: MenuOption[];
  onSave: (item: NotaItem) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [menuId, setMenuId] = useState<string>(initial?.menu_id ?? menus[0]?.id ?? '');
  const [qty, setQty] = useState<number>(initial?.qty ?? 1);
  const [notes, setNotes] = useState<string>(initial?.notes ?? '');
  const [search, setSearch] = useState<string>('');

  const filteredMenus = useMemo(() => {
    const s = search.toLowerCase().trim();
    if (!s) return menus;
    return menus.filter((m) => m.name.toLowerCase().includes(s));
  }, [search, menus]);

  const selectedMenu = menus.find((m) => m.id === menuId);

  function handleSave() {
    if (!selectedMenu || qty < 1) return;
    onSave({
      id: initial?.id,
      _localId: initial?._localId ?? crypto.randomUUID(),
      menu_id: selectedMenu.id,
      menu_name_snapshot: initial?.menu_name_snapshot ?? selectedMenu.name,
      unit_price_snapshot: initial?.id ? initial.unit_price_snapshot : selectedMenu.price,
      qty,
      notes: notes.trim() === '' ? null : notes,
      sort_order: initial?.sort_order ?? 0,
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial?.id ? 'Edit item' : 'Tambah item'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="menu-search">Cari menu</Label>
            <Input
              id="menu-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="cth: pecel lele"
              className="mt-2"
            />
          </div>

          <div className="max-h-48 overflow-y-auto rounded-md border border-clay-soft">
            {filteredMenus.length === 0 && (
              <p className="px-3 py-4 text-center text-sm text-clay">Tidak ada menu cocok.</p>
            )}
            {filteredMenus.map((m) => {
              const active = m.id === menuId;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMenuId(m.id)}
                  className={[
                    'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors',
                    active ? 'bg-gold-faint text-coal' : 'hover:bg-cream',
                  ].join(' ')}
                >
                  <span>{m.name}</span>
                  <span className="text-clay">{formatRp(m.price)}</span>
                </button>
              );
            })}
          </div>

          <div>
            <Label htmlFor="qty">Jumlah</Label>
            <div className="mt-2 flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
              >
                −
              </Button>
              <Input
                id="qty"
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                className="w-20 text-center font-display"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setQty((q) => q + 1)}
              >
                +
              </Button>
              <span className="ml-auto font-display text-lg text-coal">
                {selectedMenu ? formatRp(selectedMenu.price * qty) : '—'}
              </span>
            </div>
          </div>

          <div>
            <Label htmlFor="notes">Catatan (opsional)</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="cth: D P, Dada, tanpa sambel"
              className="mt-2"
            />
          </div>
        </div>

        <DialogFooter className="flex gap-2 pt-2">
          {onDelete && initial?.id && (
            <Button type="button" variant="destructive" onClick={onDelete}>
              🗑️ Hapus
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={onClose} className="ml-auto">
            Batal
          </Button>
          <Button type="button" onClick={handleSave} disabled={!selectedMenu || qty < 1}>
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
