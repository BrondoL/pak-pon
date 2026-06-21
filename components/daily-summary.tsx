'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatRp } from '@/lib/currency';
import { today } from '@/lib/date';

type MenuTotal = { menu_name: string; qty: number; revenue: number };
type Mismatch = {
  id: string;
  customer_name: string | null;
  handwritten: number;
  computed: number;
};

export function DailySummary({
  date,
  total,
  count,
  pendingCount,
  mismatches,
  allItems,
}: {
  date: string;
  total: number;
  count: number;
  pendingCount: number;
  mismatches: Mismatch[];
  allItems: MenuTotal[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setDate(d: string) {
    const next = new URLSearchParams(sp.toString());
    next.set('date', d);
    startTransition(() => router.replace(`?${next.toString()}`));
  }

  function shiftDay(days: number) {
    const [y, m, d] = date.split('-').map(Number);
    const shifted = new Date(Date.UTC(y, m - 1, d + days));
    setDate(shifted.toISOString().slice(0, 10));
  }

  const isToday = date === today();
  const avgPerTx = count > 0 ? Math.round(total / count) : 0;
  const totalQty = allItems.reduce((acc, it) => acc + it.qty, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <Label htmlFor="date">Tanggal</Label>
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-2"
          />
        </div>

        <div className="flex items-stretch overflow-hidden rounded-md border border-clay-soft bg-paper-soft shadow-[var(--shadow-paper)]">
          <button
            type="button"
            onClick={() => shiftDay(-1)}
            disabled={pending}
            aria-label="Hari sebelumnya"
            className="flex items-center gap-1 px-3 py-2 text-sm text-coal-soft transition-colors hover:bg-cream hover:text-coal disabled:opacity-50"
          >
            <span aria-hidden>‹</span>
            <span>Kemarin</span>
          </button>
          <button
            type="button"
            onClick={() => setDate(today())}
            disabled={pending || isToday}
            className={[
              'border-x border-clay-soft px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50',
              isToday
                ? 'bg-gold-faint text-coal'
                : 'text-coal-soft hover:bg-cream hover:text-coal',
            ].join(' ')}
          >
            Hari ini
          </button>
          <button
            type="button"
            onClick={() => shiftDay(1)}
            disabled={pending}
            aria-label="Hari berikutnya"
            className="flex items-center gap-1 px-3 py-2 text-sm text-coal-soft transition-colors hover:bg-cream hover:text-coal disabled:opacity-50"
          >
            <span>Besok</span>
            <span aria-hidden>›</span>
          </button>
        </div>
      </div>

      {(pendingCount > 0 || mismatches.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {pendingCount > 0 && (
            <Link
              href={`/transactions?date_from=${date}&date_to=${date}&status=pending_review`}
              className="group flex items-center justify-between rounded-md border border-mustard/40 bg-mustard-faint px-4 py-3 text-sm text-coal transition-colors hover:bg-mustard/20"
            >
              <div className="flex items-center gap-3">
                <span className="text-lg" aria-hidden>📝</span>
                <div>
                  <div className="font-semibold">
                    {pendingCount} transaksi belum dikonfirmasi
                  </div>
                  <div className="text-xs text-coal-soft">
                    Selesaikan dulu supaya total akurat
                  </div>
                </div>
              </div>
              <span className="text-clay group-hover:translate-x-0.5 transition-transform" aria-hidden>→</span>
            </Link>
          )}
          {mismatches.length > 0 && (
            <details className="group rounded-md border border-brick/30 bg-brick-faint text-sm text-coal">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 hover:bg-brick/10">
                <div className="flex items-center gap-3">
                  <span className="text-lg" aria-hidden>⚠️</span>
                  <div>
                    <div className="font-semibold text-brick-dark">
                      {mismatches.length} transaksi total tidak cocok
                    </div>
                    <div className="text-xs text-coal-soft">
                      Tulisan tangan ≠ perhitungan sistem
                    </div>
                  </div>
                </div>
                <span className="text-clay transition-transform group-open:rotate-180" aria-hidden>▾</span>
              </summary>
              <ul className="border-t border-brick/20 divide-y divide-brick/10">
                {mismatches.map((m) => {
                  const diff = m.handwritten - m.computed;
                  return (
                    <li key={m.id}>
                      <Link
                        href={`/transactions/${m.id}`}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-brick/10"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm text-coal">
                            {m.customer_name || <span className="italic text-clay">tanpa nama</span>}
                          </div>
                          <div className="text-[11px] text-coal-soft">
                            Tulis {formatRp(m.handwritten)} · Sistem {formatRp(m.computed)}
                          </div>
                        </div>
                        <span className={`shrink-0 font-display text-sm ${diff > 0 ? 'text-leaf' : 'text-brick'}`}>
                          {diff > 0 ? '+' : ''}{formatRp(diff)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </div>
      )}

      <Card variant="paper" className="px-6 py-10">
        <div className="text-center">
          <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
            Total Pemasukan
          </p>
          <p className="mt-3 font-display text-5xl tracking-tight text-coal md:text-6xl">
            {formatRp(total)}
          </p>
        </div>
        <div className="mt-8 grid grid-cols-3 divide-x divide-clay-soft/60 border-t border-clay-soft/60 pt-6 text-center">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-clay">Transaksi</div>
            <div className="mt-1 font-display text-2xl text-coal">{count}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-clay">Porsi terjual</div>
            <div className="mt-1 font-display text-2xl text-coal">{totalQty}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-clay">Rata-rata/tx</div>
            <div className="mt-1 font-display text-2xl text-coal">{formatRp(avgPerTx)}</div>
          </div>
        </div>
      </Card>

      {allItems.length > 0 ? (
        <Card variant="paper">
          <div className="flex items-center justify-between border-b border-clay-soft/60 px-5 py-3">
            <p className="text-xs uppercase tracking-wider text-clay">
              Menu terjual ({allItems.length} jenis)
            </p>
            <p className="text-xs text-clay">
              urut paling laris ↓
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-clay-soft/60 text-[11px] uppercase tracking-wider text-clay">
              <tr>
                <th className="px-5 py-2 text-left font-semibold">Menu</th>
                <th className="px-3 py-2 text-right font-semibold">Qty</th>
                <th className="px-3 py-2 text-right font-semibold">%</th>
                <th className="px-5 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-clay-soft/60">
              {allItems.map((it, i) => {
                const pct = total > 0 ? (it.revenue / total) * 100 : 0;
                return (
                  <tr key={it.menu_name} className={i < 3 ? 'bg-gold-faint/40' : ''}>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        {i < 3 && (
                          <span className="font-display text-xs text-clay tabular-nums w-4">{i + 1}</span>
                        )}
                        <span className={i < 3 ? 'font-medium text-coal' : 'text-coal'}>
                          {it.menu_name}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-display text-coal tabular-nums">
                      {it.qty}
                    </td>
                    <td className="px-3 py-2.5 text-right text-clay tabular-nums">
                      {pct.toFixed(1)}%
                    </td>
                    <td className="px-5 py-2.5 text-right font-display text-coal tabular-nums">
                      {formatRp(it.revenue)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : (
        <Card variant="paper" className="px-5 py-10 text-center text-sm text-clay">
          Belum ada transaksi tersimpan untuk tanggal ini.
        </Card>
      )}
    </div>
  );
}
