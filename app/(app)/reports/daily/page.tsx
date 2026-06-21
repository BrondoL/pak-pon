import { Suspense } from 'react';
import { getSupabaseServer } from '@/lib/supabase/server';
import { today, parseYmd, startOfDayWIB, endOfDayWIB } from '@/lib/date';
import { DailySummary } from '@/components/daily-summary';

export const dynamic = 'force-dynamic';

export default async function DailyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const date = (sp.date && parseYmd(sp.date)) ?? today();
  const supabase = await getSupabaseServer();

  const { data } = await supabase
    .from('transactions')
    .select('id, transaction_items(qty, unit_price_snapshot, menu_name_snapshot)')
    .eq('status', 'confirmed')
    .is('deleted_at', null)
    .gte('created_at', startOfDayWIB(date))
    .lt('created_at', endOfDayWIB(date));

  const txs = data ?? [];
  let total = 0;
  const byMenu = new Map<string, { qty: number; revenue: number }>();
  for (const tx of txs) {
    const lines = (tx.transaction_items ?? []) as Array<{
      qty: number; unit_price_snapshot: number; menu_name_snapshot: string;
    }>;
    for (const l of lines) {
      const lt = l.qty * l.unit_price_snapshot;
      total += lt;
      const prev = byMenu.get(l.menu_name_snapshot) ?? { qty: 0, revenue: 0 };
      byMenu.set(l.menu_name_snapshot, { qty: prev.qty + l.qty, revenue: prev.revenue + lt });
    }
  }
  const topItems = [...byMenu.entries()]
    .map(([menu_name, v]) => ({ menu_name, ...v }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

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
        <DailySummary date={date} total={total} count={txs.length} topItems={topItems} />
      </Suspense>
    </div>
  );
}
