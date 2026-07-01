'use client';
import type { AiUsageRow } from '@/lib/ai-usage';

export function AiUsageTable({ rows, today }: { rows: AiUsageRow[]; today: string }) {
  return <div>TODO table {rows.length} rows, today={today}</div>;
}
