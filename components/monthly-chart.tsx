'use client';

import { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
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
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(1, ...daily.map((d) => d.total));
  const activeDays = daily.filter((d) => d.total > 0);
  const avgPerDay = activeDays.length > 0 ? Math.round(total / activeDays.length) : 0;
  const bestDay = daily.reduce<DayBar | null>((b, d) => (d.total > (b?.total ?? 0) ? d : b), null);
  const todayYmd = currentBusinessDate();

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

        <div className="relative mt-6">
          <div className="absolute inset-y-0 left-0 flex flex-col justify-between pr-2 text-right text-[9px] text-clay-soft">
            <span>{formatCompactRp(max)}</span>
            <span>{formatCompactRp(max / 2)}</span>
            <span>0</span>
          </div>

          <div className="ml-9 border-l border-clay-soft/60">
            <div className="relative h-44">
              <div className="absolute inset-x-0 top-0 border-t border-dashed border-clay-soft/40" />
              <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-clay-soft/40" />
              {avgPerDay > 0 && (
                <div
                  className="absolute inset-x-0 border-t border-dashed border-brick/40"
                  style={{ top: `${100 - (avgPerDay / max) * 100}%` }}
                  title={`Rata-rata harian: ${formatRp(avgPerDay)}`}
                >
                  <span className="absolute -top-3 right-0 rounded bg-brick px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-paper">
                    avg
                  </span>
                </div>
              )}

              <div className="absolute inset-0 flex items-end gap-[2px] px-0.5">
                {daily.map((d, i) => {
                  const heightPct = (d.total / max) * 100;
                  const day = parseInt(d.date.slice(-2), 10);
                  const isToday = d.date === todayYmd;
                  const isHovered = hovered === i;
                  return (
                    <div
                      key={d.date}
                      className="group relative flex flex-1 flex-col items-center justify-end"
                      onMouseEnter={() => setHovered(i)}
                      onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
                    >
                      <div
                        className={[
                          'w-full rounded-t transition-colors',
                          d.total === 0
                            ? 'bg-clay-mist'
                            : isToday
                              ? 'bg-brick group-hover:bg-brick-dark'
                              : 'bg-gold/80 group-hover:bg-gold',
                        ].join(' ')}
                        style={{ height: `${Math.max(heightPct, d.total > 0 ? 2 : 1)}%` }}
                      />
                      {isHovered && d.total > 0 && (
                        <div className="pointer-events-none absolute -top-14 left-1/2 z-10 min-w-[110px] -translate-x-1/2 rounded-md border border-clay-soft bg-night-deep px-3 py-2 text-center shadow-[var(--shadow-stamp)]">
                          <div className="text-[10px] uppercase tracking-wide text-ink-soft">
                            {dayOfWeekShort(d.date)} {day}
                          </div>
                          <div className="font-display text-sm text-paper">
                            {formatRp(d.total)}
                          </div>
                          <div className="text-[10px] text-ink-soft">{d.count} tx</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-1 flex gap-[2px] px-0.5">
              {daily.map((d) => {
                const day = parseInt(d.date.slice(-2), 10);
                const showLabel = day === 1 || day === 5 || day === 10 || day === 15 || day === 20 || day === 25 || day === daily.length;
                return (
                  <div key={d.date} className="flex-1 text-center text-[9px] text-clay-soft">
                    {showLabel ? day : ''}
                  </div>
                );
              })}
            </div>
          </div>
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
