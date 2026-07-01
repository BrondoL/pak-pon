import { getSupabaseServer } from '@/lib/supabase/server';
import { currentBusinessDate } from '@/lib/date';
import { aggregateSummary, type AiUsageRow } from '@/lib/ai-usage';
import { SummaryCard } from './summary-card';
import { AiUsageChart } from './ai-usage-chart';
import { AiUsageTable } from './ai-usage-table';

export const dynamic = 'force-dynamic';

function subtractDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function firstDayOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

function monthLabel(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.toLocaleString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export default async function AiUsagePage() {
  const supabase = await getSupabaseServer();
  const today = currentBusinessDate();
  const thirtyDaysAgo = subtractDays(today, 29);
  const monthStart = firstDayOfMonth(today);

  const { data } = await supabase
    .from('ai_usage_daily')
    .select('*')
    .gte('date', thirtyDaysAgo)
    .order('date', { ascending: false });

  const rows = (data ?? []) as AiUsageRow[];
  const monthRows = rows.filter((r) => r.date >= monthStart);
  const summary = aggregateSummary(monthRows);
  const chartRows = [...rows].reverse();

  return (
    <div className="mx-auto max-w-4xl p-4 space-y-6">
      <div>
        <h1 className="font-display text-2xl text-coal">AI Usage</h1>
        <p className="mt-1 text-sm text-coal-soft">
          Konsumsi token OCR Gemini per hari (WIB business-day). Data mulai
          tercatat sejak fitur ini dirilis.
        </p>
      </div>
      <SummaryCard summary={summary} monthLabel={monthLabel(today)} />
      <AiUsageChart rows={chartRows} />
      <AiUsageTable rows={rows} today={today} />
    </div>
  );
}
