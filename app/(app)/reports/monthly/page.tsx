import { Suspense } from 'react';
import { getSupabaseServer } from '@/lib/supabase/server';
import {
  parseYm,
  businessMonthRange,
  businessDatesInMonth,
  currentBusinessDate,
  BUSINESS_DAY_CUTOFF_HOURS,
} from '@/lib/date';
import { MonthlyChart } from '@/components/monthly-chart';

export const dynamic = 'force-dynamic';

type MonthlyRpc = {
  total: number;
  count: number;
  by_day: { date: string; total: number; count: number }[];
  top_items: { menu_name: string; qty: number; revenue: number }[];
};

function currentYm(): string {
  return currentBusinessDate().slice(0, 7);
}

export default async function MonthlyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const sp = await searchParams;
  const ym = (sp.ym && parseYm(sp.ym)) ?? currentYm();
  const supabase = await getSupabaseServer();

  const { start, end } = businessMonthRange(ym);
  const { data } = await supabase.rpc('report_monthly', {
    p_start: start,
    p_end: end,
    p_cutoff_hours: BUSINESS_DAY_CUTOFF_HOURS,
  });
  const stats = (data as MonthlyRpc | null) ?? { total: 0, count: 0, by_day: [], top_items: [] };

  const perDay = new Map(stats.by_day.map((d) => [d.date, d]));
  const daily = businessDatesInMonth(ym).map((date) => {
    const v = perDay.get(date);
    return { date, total: v?.total ?? 0, count: v?.count ?? 0 };
  });

  return (
    <div className="space-y-8">
      <div>
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Laporan Bulanan
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          Performa <span className="italic">bulanan</span>
        </h1>
      </div>

      <Suspense>
        <MonthlyChart
          month={ym}
          total={stats.total}
          count={stats.count}
          daily={daily}
          topItems={stats.top_items}
        />
      </Suspense>
    </div>
  );
}
