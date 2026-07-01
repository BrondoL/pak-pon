import type { UsageSummary } from '@/lib/ai-usage';
import { formatRp } from '@/lib/currency';
import { estimateCostIdr } from '@/lib/pricing';

const compact = new Intl.NumberFormat('id-ID', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function SummaryCard({
  summary,
  monthLabel,
}: {
  summary: UsageSummary;
  monthLabel: string;
}) {
  const idr = estimateCostIdr(summary.input, summary.output);
  return (
    <section className="rounded-lg border border-coal/15 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-coal-soft">
        Bulan ini · {monthLabel}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Scan" value={summary.scan.toLocaleString('id-ID')} />
        <Stat
          label="Sukses / Gagal"
          value={`${summary.success.toLocaleString('id-ID')} / ${summary.fail.toLocaleString('id-ID')}`}
        />
        <Stat label="Token" value={compact.format(summary.total)} />
        <Stat label="Est. biaya" value={`~${formatRp(idr)}`} />
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-coal-soft">{label}</div>
      <div className="mt-0.5 font-display text-lg text-coal">{value}</div>
    </div>
  );
}
