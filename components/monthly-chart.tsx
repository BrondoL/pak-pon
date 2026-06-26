'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { formatRp } from '@/lib/currency';
import { currentBusinessDate } from '@/lib/date';

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

function formatCompactRp(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)} jt`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} rb`;
  return String(n);
}

const DAY_NAMES_ID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

function dayOfWeekShort(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return DAY_NAMES_ID[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
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
  const activeDays = daily.filter((d) => d.total > 0);
  const avgPerDay = activeDays.length > 0 ? Math.round(total / activeDays.length) : 0;
  const bestDay = daily.reduce<DayBar | null>((b, d) => (d.total > (b?.total ?? 0) ? d : b), null);
  const todayYmd = currentBusinessDate();
  const isEmpty = count === 0;
  const isCurrentMonth = month === todayYmd.slice(0, 7);

  const chartData = daily.map((d) => ({
    day: parseInt(d.date.slice(-2), 10),
    date: d.date,
    total: d.total,
    count: d.count,
    isToday: d.date === todayYmd,
  }));

  const chartConfig = {
    total: {
      label: 'Pemasukan',
      color: 'var(--color-gold)',
    },
  } satisfies ChartConfig;

  function setMonth(ym: string) {
    const next = new URLSearchParams(sp.toString());
    next.set('ym', ym);
    startTransition(() => router.replace(`?${next.toString()}`));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-stretch overflow-hidden rounded-md border border-clay-soft bg-paper-soft shadow-[var(--shadow-paper)]">
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, -1))}
          disabled={pending}
          aria-label="Bulan sebelumnya"
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-coal-soft transition-colors hover:bg-cream hover:text-coal disabled:opacity-50"
        >
          <span aria-hidden>‹</span>
          <span className="hidden sm:inline">{ymLabel(shiftMonth(month, -1))}</span>
          <span className="sm:hidden">Prev</span>
        </button>
        <div className="flex-1 border-x border-clay-soft px-4 py-2 text-center font-display text-lg italic text-coal">
          {ymLabel(month)}
        </div>
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, 1))}
          disabled={pending}
          aria-label="Bulan berikutnya"
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-coal-soft transition-colors hover:bg-cream hover:text-coal disabled:opacity-50"
        >
          <span className="hidden sm:inline">{ymLabel(shiftMonth(month, 1))}</span>
          <span className="sm:hidden">Next</span>
          <span aria-hidden>›</span>
        </button>
      </div>

      {isEmpty ? (
        <Card variant="paper" className="px-6 py-12 text-center">
          <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
            Total Pemasukan
          </p>
          <p className="mt-3 font-display text-3xl italic leading-snug text-coal md:text-4xl">
            Belum ada transaksi di {ymLabel(month)}.
          </p>
          <p className="mx-auto mt-3 max-w-md text-sm text-coal-soft">
            {isCurrentMonth
              ? 'Bulan ini masih kosong — mulai dengan scan nota pertama.'
              : 'Pindah ke bulan lain di navigasi atas, atau cek history.'}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {isCurrentMonth ? (
              <Link href="/scan">
                <Button>📷 Scan nota</Button>
              </Link>
            ) : (
              <Link href="/transactions">
                <Button variant="secondary">Lihat history</Button>
              </Link>
            )}
          </div>
        </Card>
      ) : (
        <Card variant="paper" className="px-6 py-8">
          <div className="text-center">
            <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
              Total Pemasukan
            </p>
            <p className="mt-3 font-display text-4xl tracking-tight text-coal md:text-5xl">
              {formatRp(total)}
            </p>
          </div>
          <div className="mt-8 grid grid-cols-3 divide-x divide-clay-soft/60 border-t border-clay-soft/60 pt-6 text-center">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-clay">Transaksi</div>
              <div className="mt-1 font-display text-2xl text-coal">{count}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-clay">Hari aktif</div>
              <div className="mt-1 font-display text-2xl text-coal">{activeDays.length}<span className="text-sm text-clay">/{daily.length}</span></div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-clay">Rata-rata/hari</div>
              <div className="mt-1 font-display text-2xl text-coal">{formatRp(avgPerDay)}</div>
            </div>
          </div>
        </Card>
      )}

      {!isEmpty && (
      <Card variant="paper" className="px-5 py-5">
        <div className="flex items-baseline justify-between">
          <p className="text-xs uppercase tracking-wider text-clay">Pemasukan per hari</p>
          {bestDay && bestDay.total > 0 && (
            <p className="text-[11px] text-clay">
              Tertinggi:{' '}
              <span className="font-semibold text-coal">
                {parseInt(bestDay.date.slice(-2), 10)} {ymLabel(month).split(' ')[0]}
              </span>
              {' '}· {formatRp(bestDay.total)}
            </p>
          )}
        </div>

        <ChartContainer
          config={chartConfig}
          className="mt-4 aspect-auto h-56 w-full"
        >
          <BarChart data={chartData} margin={{ top: 16, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid
              vertical={false}
              strokeDasharray="3 3"
              stroke="var(--color-clay-soft)"
              strokeOpacity={0.5}
            />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval={4}
              tick={{ fill: 'var(--color-clay)', fontSize: 10 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={44}
              tick={{ fill: 'var(--color-clay-soft)', fontSize: 10 }}
              tickFormatter={(v: number) => formatCompactRp(v)}
            />
            {avgPerDay > 0 && (
              <ReferenceLine
                y={avgPerDay}
                stroke="var(--color-brick)"
                strokeOpacity={0.55}
                strokeDasharray="4 4"
                label={{
                  value: 'avg',
                  position: 'right',
                  fill: 'var(--color-brick)',
                  fontSize: 9,
                  fontWeight: 700,
                }}
              />
            )}
            <ChartTooltip
              cursor={{ fill: 'var(--color-cream)', opacity: 0.5 }}
              content={
                <ChartTooltipContent
                  hideIndicator
                  labelFormatter={(_v, payload) => {
                    const item = payload?.[0]?.payload as
                      | { date: string; day: number }
                      | undefined;
                    if (!item) return '';
                    return `${dayOfWeekShort(item.date)}, ${item.day} ${ymLabel(month).split(' ')[0]}`;
                  }}
                  formatter={(value, _name, item) => {
                    const p = item.payload as { count: number };
                    return (
                      <div className="flex flex-1 items-center justify-between gap-3">
                        <span className="text-muted-foreground">{p.count} tx</span>
                        <span className="font-mono font-medium tabular-nums text-foreground">
                          {formatRp(Number(value))}
                        </span>
                      </div>
                    );
                  }}
                />
              }
            />
            <Bar dataKey="total" radius={[4, 4, 0, 0]}>
              {chartData.map((entry) => (
                <Cell
                  key={entry.date}
                  fill={
                    entry.total === 0
                      ? 'var(--color-clay-mist)'
                      : entry.isToday
                        ? 'var(--color-brick)'
                        : 'var(--color-gold)'
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </Card>
      )}

      {topItems.length > 0 && (
        <Card variant="paper">
          <div className="border-b border-clay-soft/60 px-5 py-3">
            <p className="text-xs uppercase tracking-wider text-clay">Top menu bulan ini</p>
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
                <div className="font-display text-base text-coal shrink-0">{formatRp(it.revenue)}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
