'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { formatRp } from '@/lib/currency';
import { today } from '@/lib/date';

type TopItem = { menu_name: string; qty: number; revenue: number };

export function DailySummary({
  date,
  total,
  count,
  topItems,
}: {
  date: string;
  total: number;
  count: number;
  topItems: TopItem[];
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
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
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => shiftDay(-1)} disabled={pending}>‹ kemarin</Button>
          <Button size="sm" variant="ghost" onClick={() => setDate(today())} disabled={pending}>hari ini</Button>
          <Button size="sm" variant="ghost" onClick={() => shiftDay(1)} disabled={pending}>besok ›</Button>
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

      {topItems.length > 0 && (
        <Card variant="paper">
          <div className="border-b border-clay-soft/60 px-5 py-3">
            <p className="text-xs uppercase tracking-wider text-clay">Top menu hari ini</p>
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
