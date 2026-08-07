// components/monitor-board.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
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

  async function markPaid(row: MonitorRow) {
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== row.id)); // optimistic
    try {
      const res = await fetch(`/api/transactions/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paid: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`Meja ${row.table_no ?? '-'} ditandai lunas`);
    } catch {
      setRows(prev); // rollback
      toast.error('Gagal menandai lunas, coba lagi');
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
            'Tidak ada meja belum bayar'
          ) : (
            <>
              <span className="font-display text-lg text-coal">{rows.length}</span> meja belum bayar
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
          <p className="font-display text-xl italic text-coal">Semua meja sudah bayar 🎉</p>
          <p className="mt-2 text-sm text-coal-soft">Belum ada tagihan meja yang tertunda hari ini.</p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card variant="paper" className="px-6 py-10 text-center">
          <p className="text-sm text-coal-soft">
            Tidak ada meja cocok dengan “{query.trim()}”.
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
                  <span className="font-display text-2xl leading-none text-coal">
                    {row.table_no ? `Meja ${row.table_no}` : 'Tanpa meja'}
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
                        Tandai {row.table_no ? `Meja ${row.table_no}` : 'transaksi ini'} lunas?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {row.customer_name ? `${row.customer_name} · ` : ''}
                        {formatRp(row.total)}. Transaksi akan hilang dari monitor. Batalkan lewat detail transaksi di History.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Batal</AlertDialogCancel>
                      <AlertDialogAction onClick={() => markPaid(row)}>Ya, lunas</AlertDialogAction>
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
