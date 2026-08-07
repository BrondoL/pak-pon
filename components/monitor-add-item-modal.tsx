// components/monitor-add-item-modal.tsx
'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { formatRp } from '@/lib/currency';
import { PosMenuPicker } from '@/components/pos/pos-menu-picker';
import { PosItemConfigModal, type PosCartItemDraft } from '@/components/pos/pos-item-config-modal';
import type { MenuOption } from '@/components/nota-item-modal';
import type { PrinterSettings } from '@/lib/printer-settings';
import type { MonitorRow } from '@/lib/monitor';

type DraftRow = PosCartItemDraft & { _localId: string };

function titleFor(row: MonitorRow): string {
  if (row.table_no) return `Tambah Item · Meja ${row.table_no}`;
  if (row.customer_name) return `Tambah Item · ${row.customer_name}`;
  return 'Tambah Item';
}

export function MonitorAddItemModal({
  row,
  menus,
  printerSettings,
  onClose,
  onSaved,
}: {
  row: MonitorRow;
  menus: MenuOption[];
  printerSettings: PrinterSettings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<DraftRow[]>([]);
  // Dilacak via _localId (bukan index array) — index bisa geser kalau draft
  // berubah selagi modal konfigurasi terbuka, dan overwrite baris yang salah.
  const [editingLocalId, setEditingLocalId] = useState<string | null>(null);
  const [pickingMenu, setPickingMenu] = useState<MenuOption | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Sync guard: setSubmitting async, tap kedua yang cepat bisa masuk handleSave
  // sebelum React commit state-nya.
  const submitLock = useRef(false);

  const totalAmount = draft.reduce((s, it) => s + it.unit_price_snapshot * it.qty, 0);

  /**
   * Tap kartu menu = "+1", bukan buka modal konfigurasi. Ini poin utama fitur:
   * 2 es teh = 2 tap. Baris yang sudah punya chip/catatan sengaja TIDAK ikut
   * naik qty — tap menu polos bikin baris baru supaya konfigurasi kasir tidak
   * diam-diam tertimpa.
   */
  function handleMenuTap(menu: MenuOption) {
    setDraft((prev) => {
      const idx = prev.findIndex(
        (d) => d.menu_id === menu.id && d.applied_chips.length === 0 && d.notes === null,
      );
      if (idx === -1) {
        return [
          ...prev,
          {
            _localId: crypto.randomUUID(),
            menu_id: menu.id,
            menu_name_snapshot: menu.name,
            category: menu.category,
            unit_price_snapshot: menu.price,
            qty: 1,
            notes: null,
            applied_chips: [],
          },
        ];
      }
      return prev.map((d, i) => (i === idx ? { ...d, qty: Math.min(99, d.qty + 1) } : d));
    });
  }

  function handleQtyChange(idx: number, nextQty: number) {
    setDraft((prev) => prev.map((d, i) => (i === idx ? { ...d, qty: nextQty } : d)));
  }

  function handleDelete(idx: number) {
    setDraft((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleEdit(localId: string) {
    const target = draft.find((d) => d._localId === localId);
    if (!target) return;
    const menu = menus.find((m) => m.id === target.menu_id);
    if (!menu) return;
    setEditingLocalId(localId);
    setPickingMenu(menu);
  }

  function handleConfigSave(item: PosCartItemDraft) {
    if (editingLocalId !== null) {
      setDraft((prev) =>
        prev.map((d) => (d._localId === editingLocalId ? { ...item, _localId: d._localId } : d)),
      );
    }
    setEditingLocalId(null);
    setPickingMenu(null);
  }

  async function handleSave() {
    // Diisi di Task 4.
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
        <DialogContent className="flex max-h-[92vh] w-full flex-col gap-0 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{titleFor(row)}</DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto py-2">
            <PosMenuPicker menus={menus} onMenuTap={handleMenuTap} />
          </div>

          <div className="shrink-0 border-t border-clay-soft/60 pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-clay">
              Item baru
            </p>

            {draft.length === 0 ? (
              <p className="py-4 text-center text-sm text-clay">
                Tap menu di atas untuk menambah item.
              </p>
            ) : (
              <ul className="max-h-52 divide-y divide-clay-soft/60 overflow-y-auto">
                {draft.map((it, idx) => (
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
                        onClick={() => handleQtyChange(idx, Math.max(1, it.qty - 1))}
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
                        onClick={() => handleQtyChange(idx, Math.min(99, it.qty + 1))}
                        disabled={it.qty >= 99}
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
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(idx)} aria-label={`Hapus ${it.menu_name_snapshot}`}>
                      🗑️
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 flex gap-2 pb-[max(0px,env(safe-area-inset-bottom))]">
              <Button variant="secondary" onClick={onClose} disabled={submitting}>
                Batal
              </Button>
              <Button onClick={handleSave} disabled={submitting || draft.length === 0} className="flex-1">
                {submitting ? 'Menyimpan…' : `✓ Simpan & Cetak ${draft.length > 0 ? formatRp(totalAmount) : ''}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {pickingMenu && (
        <PosItemConfigModal
          menu={pickingMenu}
          initial={editingLocalId !== null ? draft.find((d) => d._localId === editingLocalId) : undefined}
          onSave={handleConfigSave}
          onClose={() => { setPickingMenu(null); setEditingLocalId(null); }}
        />
      )}
    </>
  );
}
