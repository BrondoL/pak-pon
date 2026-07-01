'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { AiUsageRow } from '@/lib/ai-usage';
import { formatRp } from '@/lib/currency';
import { estimateCostIdr } from '@/lib/pricing';

const compact = new Intl.NumberFormat('id-ID', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function shortDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

type ChartRow = {
  date: string;
  label: string;
  input: number;
  output: number;
  scan: number;
  success: number;
  fail: number;
  idr: number;
};

function toChartRows(rows: AiUsageRow[]): ChartRow[] {
  return rows.map((r) => {
    const input = Number(r.input_tokens);
    const output = Number(r.output_tokens);
    return {
      date: r.date,
      label: shortDate(r.date),
      input,
      output,
      scan: r.scan_count,
      success: r.success_count,
      fail: r.fail_count,
      idr: estimateCostIdr(input, output),
    };
  });
}

export function AiUsageChart({ rows }: { rows: AiUsageRow[] }) {
  const data = toChartRows(rows);

  if (data.length === 0) {
    return (
      <section className="rounded-lg border border-coal/15 bg-white p-6 text-center text-sm text-coal-soft">
        Belum ada data. Data akan muncul setelah OCR scan pertama.
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-coal/15 bg-white p-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-coal-soft">
        30 hari terakhir · Token (stacked)
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveEnd" />
            <YAxis tickFormatter={(v) => compact.format(Number(v))} tick={{ fontSize: 11 }} width={48} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="input" stackId="tok" fill="var(--color-gold-dark)" name="Input" />
            <Bar dataKey="output" stackId="tok" fill="var(--color-brick-dark)" name="Output" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartRow }> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border border-coal/20 bg-white px-3 py-2 text-xs shadow-md">
      <div className="font-semibold text-coal">{row.label}</div>
      <div className="mt-1 space-y-0.5 text-coal">
        <div>Scan: {row.scan} <span className="text-coal-soft">({row.success} sukses, {row.fail} gagal)</span></div>
        <div>Input: {compact.format(row.input)}</div>
        <div>Output: {compact.format(row.output)}</div>
        <div>Est. biaya: ~{formatRp(row.idr)}</div>
      </div>
    </div>
  );
}
