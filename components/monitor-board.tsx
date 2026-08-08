// components/monitor-board.tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { formatRp } from '@/lib/currency';
import type { MonitorRow } from '@/lib/monitor';
import { MonitorDetailModal } from '@/components/monitor-detail-modal';
import { MonitorAddItemModal } from '@/components/monitor-add-item-modal';
import type { MenuOption } from '@/components/nota-item-modal';
import type { PrinterSettings } from '@/lib/printer-settings';
import { dispatchCustomerReceiptJob } from '@/lib/print-dispatch';

const POLL_MS = 15_000;
const WIB = 'Asia/Jakarta';

function formatTimeWIB(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    timeZone: WIB, hour: '2-digit', minute: '2-digit',
  });
}

export function MonitorBoard({
  initialRows,
  menus,
  printerSettings,
}: {
  initialRows: MonitorRow[];
  menus: MenuOption[];
  printerSettings: PrinterSettings;
}) {
  const [rows, setRows] = useState<MonitorRow[]>(initialRows);
  const [refreshing, setRefreshing] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addingRow, setAddingRow] = useState<MonitorRow | null>(null);
  const [query, setQuery] = useState('');

  // Ketuk ganda cepat pada "Lunas + nota" sebelum React re-render akan
  // menjalankan alurnya dua kali → dua nota untuk satu pesanan. PATCH-nya
  // idempoten, tapi kertasnya kebuang dan pelanggan bingung.
  const inFlight = useRef<Set<string>>(new Set());

  const fetchRows = useCallback(async () => {
    try {
      const res = await fetch('/api/monitor');
      if (!res.ok) return;
      const data: { rows: MonitorRow[] } = await res.json();
      setRows(data.rows);
    } catch {
      // biarkan data lama saat gagal fetch
    }
  }, []);

  useEffect(() => {
    const intervalId = setInterval(fetchRows, POLL_MS);
    return () => clearInterval(intervalId);
  }, [fetchRows]);

  async function handleManualRefresh() {
    setRefreshing(true);
    await fetchRows();
    setRefreshing(false);
  }

  function labelFor(row: MonitorRow): string {
    if (row.table_no) return `Meja ${row.table_no}`;
    if (row.customer_name) return row.customer_name;
    return 'Transaksi';
  }

  async function markPaid(row: MonitorRow, opts: { printReceipt: boolean }) {
    if (inFlight.current.has(row.id)) return;
    inFlight.current.add(row.id);

    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== row.id)); // optimistic
    try {
      const res = await fetch(`/api/transactions/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paid: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`${labelFor(row)} ditandai lunas`);
    } catch {
      setRows(prev); // rollback
      toast.error('Gagal menandai lunas, coba lagi');
      inFlight.current.delete(row.id);
      return; // JANGAN cetak kalau penandaan lunas gagal
    }

    if (!opts.printReceipt) {
      inFlight.current.delete(row.id);
      return;
    }

    // Nota butuh daftar item lengkap, yang tidak dibawa kartu monitor.
    // Transaksi sudah tercatat lunas di titik ini — kegagalan apa pun di
    // bawah cuma soal kertas, jangan rollback status.
    try {
      const res = await fetch(`/api/transactions/${row.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        transaction: {
          id: string; daily_seq: number | null; created_at: string;
          customer_name: string | null; table_no: string | null; is_takeaway: boolean;
        };
        items: Array<{
          id: string; qty: number; menu_name_snapshot: string;
          unit_price_snapshot: number; notes: string | null;
          applied_chips: Array<{ label: string; price_delta: number }> | null;
        }>;
      };

      const result = await dispatchCustomerReceiptJob({
        tx: data.transaction,
        items: data.items.map((i) => ({
          id: i.id,
          qty: i.qty,
          menu_name_snapshot: i.menu_name_snapshot,
          unit_price_snapshot: i.unit_price_snapshot,
          notes: i.notes,
          applied_chips: i.applied_chips ?? [],
        })),
        printerSettings,
      });

      if (result.ok) {
        toast.success('Nota customer dikirim ke agent');
      } else if (result.offline) {
        toast.warning(
          'Agent printer offline. Nyalakan agent lalu cetak manual dari detail transaksi.',
          { duration: 10000 },
        );
      } else {
        toast.error('Gagal kirim nota customer. Cetak manual dari detail transaksi.');
      }
    } catch {
      toast.error('Sudah ditandai lunas, tapi gagal ambil data nota. Cetak manual dari detail transaksi.');
    } finally {
      inFlight.current.delete(row.id);
    }
  }

  const total = rows.reduce((acc, r) => acc + r.total, 0);

  const q = query.trim().toLowerCase();
  const filtered =
    q === ''
      ? rows
      : rows.filter(
          (r) =>
            (r.table_no ?? '').toLowerCase().includes(q) ||
            (r.customer_name ?? '').toLowerCase().includes(q),
        );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-coal-soft">
          {rows.length === 0 ? (
            'Tidak ada pesanan belum bayar'
          ) : (
            <>
              <span className="font-display text-lg text-coal">{rows.length}</span> pesanan belum bayar
              {' · '}total <span className="font-medium text-coal">{formatRp(total)}</span>
            </>
          )}
        </p>
        <Button variant="secondary" size="sm" onClick={handleManualRefresh} disabled={refreshing}>
          {refreshing ? 'Menyegarkan…' : '↻ Refresh'}
        </Button>
      </div>

      {rows.length > 0 && (
        <div className="relative">
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari meja atau nama…"
            aria-label="Cari meja atau nama"
            className="pr-9"
          />
          {query !== '' && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Hapus pencarian"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-clay hover:text-coal"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <Card variant="paper" className="px-6 py-14 text-center">
          <p className="font-display text-xl italic text-coal">Semua pesanan sudah bayar 🎉</p>
          <p className="mt-2 text-sm text-coal-soft">Belum ada pesanan yang belum dibayar hari ini.</p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card variant="paper" className="px-6 py-10 text-center">
          <p className="text-sm text-coal-soft">
            Tidak ada pesanan cocok dengan “{query.trim()}”.
          </p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => setQuery('')}>
            Hapus pencarian
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((row) => (
            <Card key={row.id} variant="paper" className="flex flex-col gap-3 p-4">
              <button
                type="button"
                onClick={() => setDetailId(row.id)}
                className="min-w-0 text-left"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate font-display text-2xl leading-none text-coal">
                      {row.table_no ? `Meja ${row.table_no}` : 'Tanpa meja'}
                    </span>
                    {row.is_takeaway && (
                      <span className="shrink-0 rounded-full border border-gold/40 bg-gold-faint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold-dark">
                        Bungkus
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-clay">{formatTimeWIB(row.created_at)}</span>
                </div>
                <div className="mt-1 truncate text-sm text-coal-soft">
                  {row.customer_name || <span className="italic text-clay">tanpa nama</span>}
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="text-xs text-clay">{row.item_count} item</span>
                  <span className="font-display text-lg tracking-tight text-coal">{formatRp(row.total)}</span>
                </div>
              </button>

              <div className="flex gap-2">
                {/* outline, bukan secondary: --secondary = paper-soft, persis warna
                    Card variant="paper" yang menaunginya + border-transparent, jadi
                    tombolnya ga keliatan sama sekali di card. */}
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setAddingRow(row)}
                >
                  + Item
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger render={<Button className="flex-1" />}>
                    Lunas
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Tandai {labelFor(row)} lunas?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {row.customer_name ? `${row.customer_name} · ` : ''}
                        {formatRp(row.total)}. Transaksi akan hilang dari monitor. Batalkan lewat detail transaksi di History.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Batal</AlertDialogCancel>
                      {/* Tombol yang disorot ikut jenis pesanan: pelanggan bungkus
                          hampir selalu bawa notanya, pelanggan dine-in jarang minta.
                          Keduanya tetap tersedia di dua-duanya — ini arahan, bukan
                          pembatasan. */}
                      <AlertDialogAction
                        variant={row.is_takeaway ? 'outline' : 'default'}
                        onClick={() => markPaid(row, { printReceipt: false })}
                      >
                        Lunas saja
                      </AlertDialogAction>
                      <AlertDialogAction
                        variant={row.is_takeaway ? 'default' : 'outline'}
                        onClick={() => markPaid(row, { printReceipt: true })}
                      >
                        Lunas + nota
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </Card>
          ))}
        </div>
      )}

      <MonitorDetailModal id={detailId} onClose={() => setDetailId(null)} />

      {/* Jangan tambah `key={addingRow.id}` di sini, dan jangan unmount modal
          ini dari efek polling (mis. "baris hilang dari /api/monitor → tutup
          modal") — draft item yang belum disimpan hidup di state internal
          AddItemsModal (lihat components/add-items-modal.tsx). Unmount =
          draft ketikan kasir hilang percuma. */}
      {addingRow && (
        <MonitorAddItemModal
          row={addingRow}
          menus={menus}
          printerSettings={printerSettings}
          onClose={() => setAddingRow(null)}
          onSaved={() => { setAddingRow(null); void fetchRows(); }}
        />
      )}
    </div>
  );
}
