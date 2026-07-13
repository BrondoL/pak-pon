import { Suspense } from 'react';
import { getSupabaseServer } from '@/lib/supabase/server';
import { currentBusinessDate, parseYmd, businessDayRange } from '@/lib/date';
import { DailySummary } from '@/components/daily-summary';

export const dynamic = 'force-dynamic';

type DailyRpc = {
  confirmed_total: number;
  confirmed_count: number;
  pending_count: number;
  items: { menu_name: string; qty: number; revenue: number }[];
  mismatches: {
    id: string;
    customer_name: string | null;
    handwritten: number;
    computed: number;
  }[];
};

export default async function DailyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const date = (sp.date && parseYmd(sp.date)) ?? currentBusinessDate();
  const supabase = await getSupabaseServer();

  const { start, end } = businessDayRange(date);
  const { data } = await supabase.rpc('report_daily', {
    p_start: start,
    p_end: end,
  });
  const stats = (data as DailyRpc | null) ?? {
    confirmed_total: 0,
    confirmed_count: 0,
    pending_count: 0,
    items: [],
    mismatches: [],
  };

  return (
    <div className="space-y-8">
      <div>
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Laporan Harian
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          Closingan <span className="italic">harian</span>
        </h1>
        <p className="mt-2 text-sm text-coal-soft">
          Cocokkan total sistem dengan uang fisik di laci.
        </p>
      </div>

      <Suspense>
        <DailySummary
          date={date}
          total={stats.confirmed_total}
          count={stats.confirmed_count}
          pendingCount={stats.pending_count}
          mismatches={stats.mismatches}
          allItems={stats.items}
        />
      </Suspense>
    </div>
  );
}
