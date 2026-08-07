// components/add-items-modal.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { formatRp } from '@/lib/currency';
import { PosMenuPicker } from '@/components/pos/pos-menu-picker';
import { PosItemConfigModal } from '@/components/pos/pos-item-config-modal';
import {
  addOrIncrementDraft, needsChipConfig, MAX_QTY,
  type PosCartItemDraft, type DraftRow,
} from '@/lib/cart-draft';
import type { MenuOption } from '@/components/nota-item-modal';

/**
 * Modal pilih-banyak: tap menu berkali-kali, atur qty/chip di daftar bawah,
 * lalu satu tombol konfirmasi. Sengaja TIDAK tahu apa-apa soal menyimpan —
 * monitor menyambungkannya ke API + cetak, review ke state item lokal.
 *
 * State draft hidup di sini. Selama parent belum melepas komponennya, draft
 * bertahan — itulah yang bikin "gagal simpan → modal tetap terbuka, draft
 * utuh" jalan tanpa parent perlu menyimpan salinan.
 */
export function AddItemsModal({
  title,
  menus,
  confirmLabel,
  submitting = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  menus: MenuOption[];
  confirmLabel: (count: number, totalAmount: number) => string;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: (drafts: PosCartItemDraft[]) => void;
}) {
  const [rows, setRows] = useState<DraftRow[]>([]);
  // Dilacak via _localId (bukan index array) — index bisa geser kalau daftar
  // berubah selagi modal konfigurasi terbuka, dan overwrite baris yang salah.
  const [editingLocalId, setEditingLocalId] = useState<string | null>(null);
  const [pickingMenu, setPickingMenu] = useState<MenuOption | null>(null);

  const totalAmount = rows.reduce((s, it) => s + it.unit_price_snapshot * it.qty, 0);

  /**
   * Menu bergrup mutex (mis. Ayam goreng: Dada/Paha) buka modal konfigurasi
   * dulu — bagiannya harus diputuskan, bukan didiamkan. Menu lain langsung
   * masuk daftar.
   */
  function handleMenuTap(menu: MenuOption) {
    if (needsChipConfig(menu)) {
      setEditingLocalId(null);
      setPickingMenu(menu);
      return;
    }
    setRows((prev) => addOrIncrementDraft(prev, menu, crypto.randomUUID()));
  }

  function handleQtyChange(localId: string, nextQty: number) {
    setRows((prev) => prev.map((d) => (d._localId === localId ? { ...d, qty: nextQty } : d)));
  }

  function handleDelete(localId: string) {
    setRows((prev) => prev.filter((d) => d._localId !== localId));
  }

  function handleEdit(localId: string) {
    const target = rows.find((d) => d._localId === localId);
    if (!target) return;
    const menu = menus.find((m) => m.id === target.menu_id);
    if (!menu) return;
    setEditingLocalId(localId);
    setPickingMenu(menu);
  }

  /**
   * Dua jalur masuk ke sini: ✏️ pada baris yang sudah ada (editingLocalId
   * terisi → timpa baris itu), dan tap menu bergrup mutex (editingLocalId
   * null → baris baru). Batal di modal konfigurasi untuk jalur kedua berarti
   * tidak ada baris yang ditambahkan sama sekali.
   */
  function handleConfigSave(item: PosCartItemDraft) {
    if (editingLocalId !== null) {
      setRows((prev) =>
        prev.map((d) => (d._localId === editingLocalId ? { ...item, _localId: d._localId } : d)),
      );
    } else {
      setRows((prev) => [...prev, { ...item, _localId: crypto.randomUUID() }]);
    }
    setEditingLocalId(null);
    setPickingMenu(null);
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open && !submitting) onCancel(); }}>
        <DialogContent className="flex max-h-[92vh] w-full flex-col gap-0 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto py-2">
            <PosMenuPicker menus={menus} onMenuTap={handleMenuTap} />
          </div>

          <div className="shrink-0 border-t border-clay-soft/60 pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-clay">
              Item baru
            </p>

            {rows.length === 0 ? (
              <p className="py-4 text-center text-sm text-clay">
                Tap menu di atas untuk menambah item.
              </p>
            ) : (
              <ul className="max-h-52 divide-y divide-clay-soft/60 overflow-y-auto">
                {rows.map((it) => (
                  <li key={it._localId} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-coal">{it.menu_name_snapshot}</div>
                      {it.applied_chips.length > 0 && (
                        <p className="truncate text-xs text-clay">
                          {it.applied_chips.map((c) => c.label).join(', ')}
                        </p>
                      )}
                      {it.notes && (
                        <p className="truncate text-xs italic text-clay-soft">{it.notes}</p>
                      )}
                    </div>

                    <div className="inline-flex shrink-0 items-center rounded-lg border border-clay-soft/60 bg-paper">
                      <Button
                        size="icon" variant="ghost"
                        onClick={() => handleQtyChange(it._localId, Math.max(1, it.qty - 1))}
                        disabled={it.qty <= 1}
                        aria-label={`Kurangi jumlah ${it.menu_name_snapshot}`}
                        className="rounded-r-none text-lg leading-none"
                      >
                        −
                      </Button>
                      <span
                        className="min-w-8 px-1 text-center text-sm font-semibold tabular-nums text-coal"
                        aria-live="polite"
                      >
                        {it.qty}
                      </span>
                      <Button
                        size="icon" variant="ghost"
                        onClick={() => handleQtyChange(it._localId, Math.min(MAX_QTY, it.qty + 1))}
                        disabled={it.qty >= MAX_QTY}
                        aria-label={`Tambah jumlah ${it.menu_name_snapshot}`}
                        className="rounded-l-none text-lg leading-none"
                      >
                        +
                      </Button>
                    </div>

                    <span className="w-24 shrink-0 text-right font-display text-base tracking-tight tabular-nums text-coal">
                      {formatRp(it.unit_price_snapshot * it.qty)}
                    </span>

                    <Button size="icon" variant="ghost" onClick={() => handleEdit(it._localId)} aria-label={`Ubah ${it.menu_name_snapshot}`}>
                      ✏️
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(it._localId)} aria-label={`Hapus ${it.menu_name_snapshot}`}>
                      🗑️
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 flex gap-2 pb-[max(0px,env(safe-area-inset-bottom))]">
              <Button variant="secondary" onClick={onCancel} disabled={submitting}>
                Batal
              </Button>
              <Button
                onClick={() => onConfirm(rows.map(({ _localId, ...rest }) => rest))}
                disabled={submitting || rows.length === 0}
                className="flex-1"
              >
                {confirmLabel(rows.length, totalAmount)}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {pickingMenu && (
        <PosItemConfigModal
          menu={pickingMenu}
          initial={editingLocalId !== null ? rows.find((d) => d._localId === editingLocalId) : undefined}
          onSave={handleConfigSave}
          onClose={() => { setPickingMenu(null); setEditingLocalId(null); }}
        />
      )}
    </>
  );
}
