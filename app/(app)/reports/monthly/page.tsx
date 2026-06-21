import { Suspense } from 'react';
import { getSupabaseServer } from '@/lib/supabase/server';
import { parseYm, monthBoundsWIB } from '@/lib/date';
import { MonthlyChart } from '@/components/monthly-chart';

export const dynamic = 'force-dynamic';

function currentYmWIB(): string {
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  return now.toISOString().slice(0, 7);
}

function daysInMonthWIB(ym: string): string[] {
  const [yStr, mStr] = ym.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: lastDay }, (_, i) =>
    `${ym}-${String(i + 1).padStart(2, '0')}`
  );
}

function ymdInWIB(iso: string): string {
  const d = new Date(iso);
  const wib = new Date(d.getTime() + 7 * 3600 * 1000);
  return wib.toISOString().slice(0, 10);
}

export default async function MonthlyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const sp = await searchParams;
  const ym = (sp.ym && parseYm(sp.ym)) ?? currentYmWIB();
  const supabase = await getSupabaseServer();

  const { from, to } = monthBoundsWIB(ym);
  const { data } = await supabase
    .from('transactions')
    .select('id, created_at, transaction_items(qty, unit_price_snapshot, menu_name_snapshot)')
    .eq('status', 'confirmed')
    .is('deleted_at', null)
    .gte('created_at', from)
    .lt('created_at', to);

  const txs = data ?? [];
  const byDay = new Map<string, { total: number; count: number }>();
  const byMenu = new Map<string, { qty: number; revenue: number }>();
  let grandTotal = 0;

  for (const tx of txs) {
    const day = ymdInWIB(tx.created_at);
    const lines = (tx.transaction_items ?? []) as Array<{
      qty: number; unit_price_snapshot: number; menu_name_snapshot: string;
    }>;
    const txTotal = lines.reduce((acc, l) => acc + l.qty * l.unit_price_snapshot, 0);
    grandTotal += txTotal;
    const d = byDay.get(day) ?? { total: 0, count: 0 };
    byDay.set(day, { total: d.total + txTotal, count: d.count + 1 });

    for (const l of lines) {
      const prev = byMenu.get(l.menu_name_snapshot) ?? { qty: 0, revenue: 0 };
      byMenu.set(l.menu_name_snapshot, {
        qty: prev.qty + l.qty,
        revenue: prev.revenue + l.qty * l.unit_price_snapshot,
      });
    }
  }

  const daily = daysInMonthWIB(ym).map((date) => {
    const v = byDay.get(date) ?? { total: 0, count: 0 };
    return { date, total: v.total, count: v.count };
  });

  const topItems = [...byMenu.entries()]
    .map(([menu_name, v]) => ({ menu_name, ...v }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

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
          total={grandTotal}
          count={txs.length}
          daily={daily}
          topItems={topItems}
        />
      </Suspense>
    </div>
  );
}
