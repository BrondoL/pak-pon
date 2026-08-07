// components/monitor-add-item-modal.tsx
'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { dispatchKitchenPrintJob, splitItemsByPrintTarget, type PrintTarget } from '@/lib/print-dispatch';
import { AddItemsModal } from '@/components/add-items-modal';
import { formatRp } from '@/lib/currency';
import type { PosCartItemDraft } from '@/lib/cart-draft';
import type { MenuOption } from '@/components/nota-item-modal';
import type { PrinterSettings } from '@/lib/printer-settings';
import type { MonitorRow } from '@/lib/monitor';

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
  const [submitting, setSubmitting] = useState(false);
  // Sync guard: setSubmitting async, tap kedua yang cepat bisa masuk
  // handleConfirm sebelum React commit state-nya.
  const submitLock = useRef(false);

  async function handleConfirm(drafts: PosCartItemDraft[]) {
    if (drafts.length === 0) return;
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
          items: drafts.map((it) => ({
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
      const pairCount = Math.min(created.length, drafts.length);
      const withIds = drafts.slice(0, pairCount).map((it, idx) => ({
        ...it,
        id: created[idx].id,
      }));
      if (created.length !== drafts.length) {
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
        toast.success(`${drafts.length} item ditambahkan, ${results.length} print job dikirim`);
      } else if (offlineCount > 0) {
        toast.success(`${drafts.length} item ditambahkan`);
        toast.warning(
          'Agent printer offline. Nyalakan agent lalu cetak manual dari detail transaksi.',
          { duration: 10000 },
        );
      } else {
        toast.success(`${drafts.length} item ditambahkan`);
        toast.error(`Gagal kirim print: ${failed.map((f) => f.target).join(', ')}`);
      }

      onSaved();
    } catch (err) {
      if (!saved) {
        // Insert belum commit — modal sengaja tetap terbuka & draft
        // dipertahankan (state-nya hidup di AddItemsModal yang masih
        // ter-mount), kasir tinggal menekan Simpan lagi tanpa mengetik ulang.
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
    <AddItemsModal
      title={titleFor(row)}
      menus={menus}
      submitting={submitting}
      confirmLabel={(count, total) =>
        submitting ? 'Menyimpan…' : `✓ Simpan & Cetak ${count > 0 ? formatRp(total) : ''}`
      }
      onCancel={onClose}
      onConfirm={handleConfirm}
    />
  );
}
