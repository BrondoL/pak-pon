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

const CATEGORY_ORDER: MenuOption['category'][] = ['makanan', 'nasi', 'minuman'];
const CATEGORY_LABEL: Record<MenuOption['category'], string> = {
  makanan: '🍛 Makanan',
  nasi: '🍚 Nasi',
  minuman: '🥤 Minuman',
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

  const selectedMenu = menus.find((m) => m.id === menuId);

  // Default tab: edit item → initial's category. New item → makanan (most-used).
  const [activeCategory, setActiveCategory] = useState<MenuOption['category']>(
    initial ? (menus.find((m) => m.id === initial.menu_id)?.category ?? 'makanan') : 'makanan'
  );

  // Search overrides the category filter — if user typed anything, search across
  // ALL categories so they don't have to guess which tab the menu lives in.
  const isSearching = search.trim().length > 0;
  const visibleMenus = useMemo(() => {
    const s = search.toLowerCase().trim();
    if (s) return menus.filter((m) => m.name.toLowerCase().includes(s));
    return menus.filter((m) => m.category === activeCategory);
  }, [menus, activeCategory, search]);

  const categoryCounts = useMemo(() => {
    const counts: Record<MenuOption['category'], number> = { makanan: 0, nasi: 0, minuman: 0 };
    for (const m of menus) counts[m.category]++;
    return counts;
  }, [menus]);

  function handleSave() {
    if (!selectedMenu || qty < 1) return;
    // Snapshot follows the selected menu: if kasir picked a different menu mid-edit,
    // the name + price MUST update. Only preserve old snapshot when menu hasn't changed
    // (keeps historical price if the menu's master price drifted since first scan).
    const menuChanged = !initial?.id || initial.menu_id !== selectedMenu.id;
    onSave({
      id: initial?.id,
      _localId: initial?._localId ?? crypto.randomUUID(),
      menu_id: selectedMenu.id,
      menu_name_snapshot: menuChanged ? selectedMenu.name : initial.menu_name_snapshot,
      unit_price_snapshot: menuChanged ? selectedMenu.price : initial.unit_price_snapshot,
      qty,
      notes: notes.trim() === '' ? null : notes,
      sort_order: initial?.sort_order ?? 0,
      confidence: null,
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

          <div className="grid grid-cols-3 gap-1.5" aria-hidden={isSearching}>
            {CATEGORY_ORDER.map((cat) => {
              const active = !isSearching && cat === activeCategory;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    setActiveCategory(cat);
                    if (isSearching) setSearch('');
                  }}
                  disabled={isSearching}
                  className={[
                    'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                    active
                      ? 'border-coal bg-coal text-paper'
                      : 'border-clay-soft bg-paper-soft text-coal hover:bg-cream',
                    isSearching ? 'opacity-50 cursor-not-allowed' : '',
                  ].join(' ')}
                >
                  {CATEGORY_LABEL[cat]} <span className="text-[10px] opacity-70">({categoryCounts[cat]})</span>
                </button>
              );
            })}
          </div>

          <div className="max-h-64 overflow-y-auto rounded-md border border-clay-soft">
            {visibleMenus.length === 0 && (
              <p className="px-3 py-4 text-center text-sm text-clay">
                {isSearching
                  ? `Tidak ada menu cocok dengan "${search.trim()}".`
                  : `Tidak ada menu di ${CATEGORY_LABEL[activeCategory]}.`}
              </p>
            )}
            {visibleMenus.map((m) => {
              const active = m.id === menuId;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMenuId(m.id)}
                  className={[
                    'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors',
                    active ? 'bg-gold-faint text-coal' : 'hover:bg-cream',
                  ].join(' ')}
                >
                  <span className="flex items-baseline gap-2 min-w-0">
                    <span className="truncate">{m.name}</span>
                    {isSearching && (
                      <span className="text-[10px] uppercase tracking-wider text-clay">
                        {m.category}
                      </span>
                    )}
                  </span>
                  <span className="text-clay shrink-0">{formatRp(m.price)}</span>
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
