import { getSupabaseServer } from './supabase/server';
import { businessDate } from './date';

export type Attempt = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

export type RecordUsageArgs = {
  attempts: Attempt[];
  failed: boolean;
  requestStartedAt?: Date;
};

export type AiUsageRow = {
  date: string;
  scan_count: number;
  success_count: number;
  fail_count: number;
  input_tokens: number | string;
  output_tokens: number | string;
  total_tokens: number | string;
  created_at: string;
  updated_at: string;
};

/**
 * Server-computed view of AiUsageRow with tokens coerced to number and IDR
 * pre-computed. Passed to client components (chart, table) so pricing envs
 * (non-NEXT_PUBLIC) don't need to reach the browser — avoids hydration mismatch.
 */
export type DailyUsageView = {
  date: string;
  scan_count: number;
  success_count: number;
  fail_count: number;
  input: number;
  output: number;
  total: number;
  idr: number;
};

export async function recordUsageDaily(args: RecordUsageArgs): Promise<void> {
  try {
    if (!args.attempts?.length) return;

    const input = args.attempts.reduce((s, a) => s + (a.input_tokens ?? 0), 0);
    const output = args.attempts.reduce((s, a) => s + (a.output_tokens ?? 0), 0);
    const total = args.attempts.reduce((s, a) => s + (a.total_tokens ?? 0), 0);
    if (input === 0 && output === 0) return;

    const dateWIB = businessDate(args.requestStartedAt ?? new Date());
    const supabase = await getSupabaseServer();
    const { error } = await supabase.rpc('increment_ai_usage_daily', {
      p_date: dateWIB,
      p_scan: 1,
      p_success: args.failed ? 0 : 1,
      p_fail: args.failed ? 1 : 0,
      p_input: input,
      p_output: output,
      p_total: total,
    });
    if (error) console.warn('[ai-usage] upsert failed', error);
  } catch (err) {
    console.warn('[ai-usage] recordUsageDaily threw', err);
  }
}

export type UsageSummary = {
  scan: number;
  success: number;
  fail: number;
  input: number;
  output: number;
  total: number;
};

export function aggregateSummary(rows: AiUsageRow[]): UsageSummary {
  return rows.reduce<UsageSummary>(
    (acc, r) => ({
      scan: acc.scan + r.scan_count,
      success: acc.success + r.success_count,
      fail: acc.fail + r.fail_count,
      input: acc.input + Number(r.input_tokens),
      output: acc.output + Number(r.output_tokens),
      total: acc.total + Number(r.total_tokens),
    }),
    { scan: 0, success: 0, fail: 0, input: 0, output: 0, total: 0 }
  );
}
