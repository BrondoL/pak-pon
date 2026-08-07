// components/monitor-add-item-modal.tsx
'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { formatRp } from '@/lib/currency';
import { dispatchKitchenPrintJob, splitItemsByPrintTarget, type PrintTarget } from '@/lib/print-dispatch';
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

  function handleQtyChange(_localId: string, nextQty: number) {
    setDraft((prev) => prev.map((d) => (d._localId === _localId ? { ...d, qty: nextQty } : d)));
  }

  function handleDelete(_localId: string) {
    setDraft((prev) => prev.filter((d) => d._localId !== _localId));
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
    if (draft.length === 0) return;
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    // Dilacak terpisah dari submitLock: insert bisa sukses lalu tahap cetak
    // yang gagal (lihat catch di bawah) — begitu insert commit, retry via
    // "Simpan" lagi akan dobel-insert item ke tagihan yang sama.
    let saved = false;
    try {
      const res = await fetch(`/api/transactions/${row.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: draft.map((it) => ({
            menu_id: it.menu_id,
            qty: it.qty,
            chip_labels: it.applied_chips.map((c) => c.label),
            notes: it.notes,
          })),
        }),
      });

      if (!res.ok) {
        // 404/409 = transaksi sudah tidak relevan; tidak ada gunanya kasir
        // mencoba lagi dengan draft yang sama → tutup + refresh daftar.
        if (res.status === 404 || res.status === 409) {
          toast.error(
            res.status === 404 ? 'Transaksi sudah tidak ada' : 'Transaksi sudah tidak aktif',
          );
          onSaved();
          return;
        }
        // 400 = menu/chip request ga cocok lagi sama master data — biasanya
        // owner ubah menu selagi dashboard ini kebuka lama (data SSR basi).
        // Reload, bukan retry, yang bisa menolong; modal tetap terbuka biar
        // draft ga hilang selagi kasir reload.
        if (res.status === 400) {
          toast.error('Menu sudah berubah', {
            description: 'Reload halaman ini dulu, lalu coba tambah item lagi.',
          });
          submitLock.current = false;
          return;
        }
        // 401 = sesi login habis (tablet nyala lama semalaman). Retry pasti
        // gagal lagi — jangan kasih kesan "coba lagi" di pesan errornya.
        if (res.status === 401) {
          toast.error('Sesi login habis', {
            description: 'Login ulang untuk lanjut menambah item.',
          });
          submitLock.current = false;
          return;
        }
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'save-failed');
      }

      // Status 201 = insert SUDAH commit di server, titik ini juga — bukan
      // setelah body ke-parse. Body 201 bisa gagal dibaca sendiri (WiFi tablet
      // kasir putus di tengah stream setelah status line terkirim); kalau
      // `saved` baru di-set setelah res.json(), skenario itu jatuh ke jalur
      // retry catch dan bikin item ke-insert dobel. Jangan pindahkan ke bawah
      // parsing lagi.
      saved = true;
      const data = (await res.json()) as {
        transaction: {
          id: string;
          daily_seq: number | null;
          created_at: string;
          customer_name: string | null;
          table_no: string | null;
          is_takeaway: boolean;
        };
        items: Array<{ id: string; sort_order: number }>;
      };

      // Cocokkan draft ke baris hasil insert lewat sort_order (server assign
      // berurutan mengikuti urutan kiriman), bukan asumsi urutan array response.
      const created = [...data.items].sort((a, b) => a.sort_order - b.sort_order);
      // Jangan fabrikasi id kalau response lebih pendek dari draft — id palsu
      // tidak match trigger DB (`id = ANY(item_ids)`), item itu tercetak di
      // kertas tapi tercatat permanen sebagai belum tercetak. Pasangkan
      // positional hanya sepanjang baris yang benar-benar dikembalikan server.
      const pairCount = Math.min(created.length, draft.length);
      const withIds = draft.slice(0, pairCount).map((it, idx) => ({
        ...it,
        id: created[idx].id,
      }));
      if (created.length !== draft.length) {
        toast.warning(
          'Jumlah item yang tersimpan tidak sesuai dengan yang dikirim. Cek detail transaksi.',
          { duration: 10000 },
        );
      }

      // Hanya item baru yang dicetak. Item lama tidak tersentuh di server, jadi
      // tidak perlu filter printed_*_at seperti di nota-review-form.
      const split = splitItemsByPrintTarget(withIds);
      const jobs: Promise<{ target: PrintTarget; ok: boolean; offline: boolean }>[] = [];
      if (split.dapur.length > 0) {
        jobs.push(
          dispatchKitchenPrintJob({
            tx: data.transaction, target: 'dapur', items: split.dapur,
            trigger: 'auto_additional', printerSettings,
          }).then((r) => ({ ...r, target: 'dapur' as const })),
        );
      }
      if (split.minuman.length > 0) {
        jobs.push(
          dispatchKitchenPrintJob({
            tx: data.transaction, target: 'minuman', items: split.minuman,
            trigger: 'auto_additional', printerSettings,
          }).then((r) => ({ ...r, target: 'minuman' as const })),
        );
      }
      const results = await Promise.all(jobs);
      const failed = results.filter((r) => !r.ok);
      const offlineCount = failed.filter((f) => f.offline).length;

      if (failed.length === 0) {
        toast.success(`${draft.length} item ditambahkan, ${results.length} print job dikirim`);
      } else if (offlineCount > 0) {
        toast.success(`${draft.length} item ditambahkan`);
        toast.warning(
          'Agent printer offline. Nyalakan agent lalu cetak manual dari detail transaksi.',
          { duration: 10000 },
        );
      } else {
        toast.success(`${draft.length} item ditambahkan`);
        toast.error(`Gagal kirim print: ${failed.map((f) => f.target).join(', ')}`);
      }

      onSaved();
    } catch (err) {
      if (!saved) {
        // Insert belum commit — modal sengaja tetap terbuka & draft
        // dipertahankan, kasir tinggal menekan Simpan lagi tanpa mengetik
        // ulang pesanannya.
        toast.error('Gagal menambah item', {
          description: err instanceof Error ? err.message : 'Coba lagi.',
        });
        submitLock.current = false;
      } else {
        // Insert sudah commit, error ini terjadi di tahap cetak (mis.
        // renderKitchenTicket melempar sebelum request /api/print/send
        // sempat jalan). Item SUDAH tersimpan — jangan undang retry (dobel
        // insert ke tagihan yang sama), tutup modal & refresh daftar supaya
        // kasir lihat total yang benar, minta cetak manual.
        toast.success('Item tersimpan');
        toast.error('Gagal cetak tiket. Cetak manual dari detail transaksi.');
        onSaved();
      }
    } finally {
      setSubmitting(false);
    }
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
                {draft.map((it) => (
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
                        onClick={() => handleQtyChange(it._localId, Math.min(99, it.qty + 1))}
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
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(it._localId)} aria-label={`Hapus ${it.menu_name_snapshot}`}>
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
