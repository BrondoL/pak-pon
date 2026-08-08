'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { formatRp } from '@/lib/currency';
import type { MenuOption } from '@/components/nota-item-modal';

const CATEGORY_ORDER: MenuOption['category'][] = ['makanan', 'nasi', 'minuman'];
const CATEGORY_LABEL: Record<MenuOption['category'], string> = {
  makanan: '🍛 Makanan',
  nasi: '🍚 Nasi',
  minuman: '🥤 Minuman',
};

/** Lama kartu menyala setelah baris mendarat. Pudarnya diurus transition kartu. */
const FLASH_MS = 400;

export function PosMenuPicker({
  menus,
  onMenuTap,
}: {
  menus: MenuOption[];
  /**
   * `true` = baris mendarat di daftar → picker menyalakan kartunya.
   * `false` = parent membuka modal konfigurasi → tanpa kilatan, karena
   * batal di modal berarti tidak ada baris yang ditambahkan.
   */
  onMenuTap: (menu: MenuOption) => boolean;
}) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<MenuOption['category']>('makanan');

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

  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  function handleTap(menu: MenuOption) {
    const landed = onMenuTap(menu);
    if (isSearching) setSearch('');
    if (!landed) return;
    // Tap beruntun cukup me-reset timer — tidak ada animasi yang perlu di-restart.
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlashId(menu.id);
    flashTimer.current = setTimeout(() => {
      setFlashId(null);
      flashTimer.current = null;
    }, FLASH_MS);
  }

  return (
    <div className="space-y-3">
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari menu…" />

      <div className="grid grid-cols-3 gap-1.5" aria-hidden={isSearching}>
        {CATEGORY_ORDER.map((cat) => {
          const active = !isSearching && cat === activeCategory;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => { setActiveCategory(cat); if (isSearching) setSearch(''); }}
              disabled={isSearching}
              className={[
                'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                active ? 'border-coal bg-coal text-paper' : 'border-clay-soft bg-paper-soft text-coal hover:bg-cream',
                isSearching ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
            >
              {CATEGORY_LABEL[cat]} <span className="text-[10px] opacity-70">({categoryCounts[cat]})</span>
            </button>
          );
        })}
      </div>

      <div className="grid auto-rows-fr grid-cols-2 gap-2 sm:grid-cols-3">
        {visibleMenus.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-clay">
            {isSearching ? `Tidak ada menu cocok dengan "${search.trim()}".` : `Tidak ada menu di ${CATEGORY_LABEL[activeCategory]}.`}
          </p>
        )}
        {visibleMenus.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => handleTap(m)}
            className={[
              'flex h-full w-full flex-col justify-between rounded-lg border border-clay-soft bg-paper-soft p-3 text-left transition-colors duration-500 hover:bg-cream',
              flashId === m.id ? 'tap-flash' : '',
            ].join(' ')}
          >
            <div>
              <div className="font-medium text-coal">{m.name}</div>
              <div className="mt-1 text-xs text-clay">{formatRp(m.price)}</div>
            </div>
            {m.chips.length > 0 && (
              <div className="mt-2 text-[10px] text-mustard">{m.chips.length} pilihan</div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
