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
  chips: Array<{
    id: string;
    label: string;
    price_delta: number;
    mutex_group: string | null;
    sort_order: number;
  }>;
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
  const [selectedChipLabels, setSelectedChipLabels] = useState<string[]>(
    initial?.applied_chips?.map((c) => c.label) ?? []
  );
  // Track which menu the chip selection belongs to so we can reset it
  // during render (React-recommended pattern) whenever kasir picks a
  // different menu — chips from previous menu are invalid.
  const [chipsMenuId, setChipsMenuId] = useState<string>(initial?.menu_id ?? menus[0]?.id ?? '');
  if (chipsMenuId !== menuId) {
    setChipsMenuId(menuId);
    setSelectedChipLabels(
      initial && menuId === initial.menu_id
        ? initial.applied_chips?.map((c) => c.label) ?? []
        : []
    );
  }

  const selectedMenu = menus.find((m) => m.id === menuId);

  const chipDelta = useMemo(() => {
    if (!selectedMenu) return 0;
    return selectedMenu.chips
      .filter((c) => selectedChipLabels.includes(c.label))
      .reduce((sum, c) => sum + c.price_delta, 0);
  }, [selectedMenu, selectedChipLabels]);

  const effectiveUnitPrice = (selectedMenu?.price ?? 0) + chipDelta;

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
    const menuChanged = !initial?.id || initial.menu_id !== selectedMenu.id;
    const applied_chips = selectedMenu.chips
      .filter((c) => selectedChipLabels.includes(c.label))
      .map((c) => ({ label: c.label, price_delta: c.price_delta }));
    // Preserve historical unit_price for unchanged menu + unchanged chips.
    const origChipsKey = (initial?.applied_chips ?? [])
      .map((c) => c.label).sort().join('|');
    const newChipsKey = applied_chips.map((c) => c.label).sort().join('|');
    const chipsChanged = origChipsKey !== newChipsKey;
    const preserveOldPrice = !menuChanged && !chipsChanged && initial?.unit_price_snapshot;
    const chipDeltaSum = applied_chips.reduce((s, c) => s + c.price_delta, 0);
    const unit_price_snapshot = preserveOldPrice
      ? initial.unit_price_snapshot
      : selectedMenu.price + chipDeltaSum;
    onSave({
      id: initial?.id,
      _localId: initial?._localId ?? crypto.randomUUID(),
      menu_id: selectedMenu.id,
      menu_name_snapshot: menuChanged ? selectedMenu.name : initial.menu_name_snapshot,
      unit_price_snapshot,
      qty,
      notes: notes.trim() === '' ? null : notes,
      applied_chips,
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
                {selectedMenu ? formatRp(effectiveUnitPrice * qty) : '—'}
              </span>
            </div>
          </div>

          {selectedMenu && selectedMenu.chips.length > 0 && (
            <ChipPicker
              chips={selectedMenu.chips}
              selectedLabels={selectedChipLabels}
              onChange={setSelectedChipLabels}
            />
          )}

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

function ChipPicker({
  chips,
  selectedLabels,
  onChange,
}: {
  chips: MenuOption['chips'];
  selectedLabels: string[];
  onChange: (next: string[]) => void;
}) {
  const groups = useMemo(() => {
    const mutex = new Map<string, typeof chips>();
    const free: typeof chips = [];
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

  function pickMutexChip(groupChips: typeof chips, label: string) {
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
