import type { UsageSummary } from '@/lib/ai-usage';

export function SummaryCard({ summary, monthLabel }: { summary: UsageSummary; monthLabel: string }) {
  return <div>TODO summary {monthLabel} scan={summary.scan}</div>;
}
