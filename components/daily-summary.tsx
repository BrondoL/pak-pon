'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatRp } from '@/lib/currency';
import { today } from '@/lib/date';

type MenuTotal = { menu_name: string; qty: number; revenue: number };

export function DailySummary({
  date,
  total,
  count,
  topItems,
  allItems,
}: {
  date: string;
  total: number;
  count: number;
  topItems: MenuTotal[];
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

      <Card variant="paper" className="px-6 py-10 text-center">
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Total Pemasukan
        </p>
        <p className="mt-3 font-display text-5xl tracking-tight text-coal md:text-6xl">
          {formatRp(total)}
        </p>
        <p className="mt-3 text-sm text-coal-soft">
          dari <strong>{count}</strong> transaksi
        </p>
      </Card>

      {allItems.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <Card variant="paper" className="flex flex-col">
            <div className="border-b border-clay-soft/60 px-5 py-3">
              <p className="text-xs uppercase tracking-wider text-clay">Top 5 menu hari ini</p>
            </div>
            <ul className="divide-y divide-clay-soft/60">
              {topItems.map((it, i) => (
                <li key={it.menu_name} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-display text-lg text-clay w-6 shrink-0">{i + 1}</span>
                    <div className="min-w-0">
                      <div className="font-medium text-coal truncate">{it.menu_name}</div>
                      <div className="text-xs text-clay">{it.qty} porsi</div>
                    </div>
                  </div>
                  <div className="font-display text-base text-coal shrink-0">
                    {formatRp(it.revenue)}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card variant="paper" className="flex flex-col">
            <div className="border-b border-clay-soft/60 px-5 py-3">
              <p className="text-xs uppercase tracking-wider text-clay">
                Semua menu terjual ({allItems.length})
              </p>
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-clay-soft/60 text-[11px] uppercase tracking-wider text-clay">
                <tr>
                  <th className="px-5 py-2 text-left font-semibold">Menu</th>
                  <th className="px-3 py-2 text-right font-semibold">Qty</th>
                  <th className="px-5 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-clay-soft/60">
                {allItems.map((it) => (
                  <tr key={it.menu_name}>
                    <td className="px-5 py-2.5 text-coal">
                      <span className="truncate block">{it.menu_name}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-display text-coal tabular-nums">
                      {it.qty}
                    </td>
                    <td className="px-5 py-2.5 text-right font-display text-coal tabular-nums">
                      {formatRp(it.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
