'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatRp } from '@/lib/currency';

type DayBar = { date: string; total: number; count: number };
type TopItem = { menu_name: string; qty: number; revenue: number };

function ymLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${monthNames[parseInt(m, 10) - 1]} ${y}`;
}

function shiftMonth(ym: string, delta: number): string {
  const [yStr, mStr] = ym.split('-');
  let y = parseInt(yStr, 10);
  let m = parseInt(mStr, 10) + delta;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function MonthlyChart({
  month,
  total,
  count,
  daily,
  topItems,
}: {
  month: string;
  total: number;
  count: number;
  daily: DayBar[];
  topItems: TopItem[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const max = Math.max(1, ...daily.map((d) => d.total));

  function setMonth(ym: string) {
    const next = new URLSearchParams(sp.toString());
    next.set('ym', ym);
    startTransition(() => router.replace(`?${next.toString()}`));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setMonth(shiftMonth(month, -1))} disabled={pending}>
            ‹ {ymLabel(shiftMonth(month, -1))}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMonth(shiftMonth(month, 1))} disabled={pending}>
            {ymLabel(shiftMonth(month, 1))} ›
          </Button>
        </div>
        <span className="font-display text-xl text-coal italic">{ymLabel(month)}</span>
      </div>

      <Card variant="paper" className="px-6 py-8 text-center">
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Total Pemasukan Bulan {ymLabel(month)}
        </p>
        <p className="mt-3 font-display text-4xl tracking-tight text-coal md:text-5xl">
          {formatRp(total)}
        </p>
        <p className="mt-2 text-sm text-coal-soft">
          dari <strong>{count}</strong> transaksi
        </p>
      </Card>

      <Card variant="paper" className="px-5 py-5">
        <p className="text-xs uppercase tracking-wider text-clay">Pemasukan per hari</p>
        <div className="mt-4 flex h-40 items-end gap-1">
          {daily.map((d) => {
            const heightPct = (d.total / max) * 100;
            const day = parseInt(d.date.slice(-2), 10);
            return (
              <div key={d.date} className="group relative flex-1 flex flex-col items-center justify-end">
                <div
                  className="w-full rounded-t bg-gold/80 transition-all hover:bg-gold"
                  style={{ height: `${heightPct}%`, minHeight: d.total > 0 ? 2 : 0 }}
                  title={`${d.date}: ${formatRp(d.total)} (${d.count} tx)`}
                />
                <span className="mt-1 text-[9px] text-clay">{day}</span>
              </div>
            );
          })}
        </div>
      </Card>

      {topItems.length > 0 && (
        <Card variant="paper">
          <div className="border-b border-clay-soft/60 px-5 py-3">
            <p className="text-xs uppercase tracking-wider text-clay">Top menu bulan ini</p>
          </div>
          <ul className="divide-y divide-clay-soft/60">
            {topItems.map((it, i) => (
              <li key={it.menu_name} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="font-display text-lg text-clay w-6">{i + 1}</span>
                  <div>
                    <div className="font-medium text-coal">{it.menu_name}</div>
                    <div className="text-xs text-clay">{it.qty} porsi</div>
                  </div>
                </div>
                <div className="font-display text-base text-coal">{formatRp(it.revenue)}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
