import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc, mockClient } = vi.hoisted(() => {
  const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const mockClient = { rpc: mockRpc };
  return { mockRpc, mockClient };
});

vi.mock('./supabase/server', () => ({
  getSupabaseServer: vi.fn().mockResolvedValue(mockClient),
}));

vi.mock('./date', () => ({
  businessDate: vi.fn().mockReturnValue('2026-07-02'),
}));

import { recordUsageDaily, aggregateSummary } from './ai-usage';
import type { AiUsageRow } from './ai-usage';

describe('recordUsageDaily', () => {
  beforeEach(() => {
    mockRpc.mockClear();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  it('skips when attempts array is empty', async () => {
    await recordUsageDaily({ attempts: [], failed: false });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('skips when input+output tokens are all zero', async () => {
    await recordUsageDaily({
      attempts: [{ input_tokens: 0, output_tokens: 0, total_tokens: 0 }],
      failed: false,
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('records success (failed=false) with success=1, fail=0', async () => {
    await recordUsageDaily({
      attempts: [{ input_tokens: 500, output_tokens: 700, thoughts_tokens: 600, total_tokens: 1200, finish_reason: 'STOP' }],
      failed: false,
    });
    expect(mockRpc).toHaveBeenCalledWith('increment_ai_usage_daily', {
      p_date: '2026-07-02',
      p_scan: 1,
      p_success: 1,
      p_fail: 0,
      p_anomaly: 0,
      p_input: 500,
      p_output: 700,
      p_thoughts: 600,
      p_total: 1200,
    });
  });

  it('records failure (failed=true) with success=0, fail=1', async () => {
    await recordUsageDaily({
      attempts: [{ input_tokens: 1089, output_tokens: 0, total_tokens: 1089 }],
      failed: true,
    });
    expect(mockRpc).toHaveBeenCalledWith('increment_ai_usage_daily', expect.objectContaining({
      p_success: 0,
      p_fail: 1,
      p_anomaly: 0,
      p_input: 1089,
      p_output: 0,
      p_thoughts: 0,
      p_total: 1089,
    }));
  });

  it('flags anomaly=1 when attempt finish_reason is MAX_TOKENS (runaway)', async () => {
    await recordUsageDaily({
      attempts: [{ input_tokens: 1481, output_tokens: 65521, thoughts_tokens: 0, total_tokens: 67002, finish_reason: 'MAX_TOKENS' }],
      failed: true,
    });
    expect(mockRpc).toHaveBeenCalledWith('increment_ai_usage_daily', expect.objectContaining({
      p_anomaly: 1,
      p_fail: 1,
    }));
  });

  it('does not flag anomaly when finish_reason is undefined (API error before response)', async () => {
    await recordUsageDaily({
      attempts: [{ input_tokens: 100, output_tokens: 50 }],
      failed: true,
    });
    expect(mockRpc).toHaveBeenCalledWith('increment_ai_usage_daily', expect.objectContaining({
      p_anomaly: 0,
    }));
  });

  it('sums multiple attempts (retry scenario) — hypothetical multi-attempt', async () => {
    await recordUsageDaily({
      attempts: [
        { input_tokens: 500, output_tokens: 700, thoughts_tokens: 600, total_tokens: 1200 },
        { input_tokens: 500, output_tokens: 720, thoughts_tokens: 600, total_tokens: 1220 },
      ],
      failed: false,
    });
    expect(mockRpc).toHaveBeenCalledWith('increment_ai_usage_daily', expect.objectContaining({
      p_input: 1000,
      p_output: 1420,
      p_thoughts: 1200,
      p_total: 2420,
    }));
  });

  it('swallows RPC errors (best-effort)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      recordUsageDaily({
        attempts: [{ input_tokens: 100, output_tokens: 10 }],
        failed: false,
      })
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('aggregateSummary', () => {
  it('returns zeros for empty array', () => {
    expect(aggregateSummary([])).toEqual({
      scan: 0, success: 0, fail: 0, anomaly: 0, input: 0, output: 0, thoughts: 0, total: 0,
    });
  });

  it('sums rows with number tokens', () => {
    const rows: AiUsageRow[] = [
      { date: '2026-07-01', scan_count: 10, success_count: 9, fail_count: 1, anomaly_count: 1,
        input_tokens: 1000, output_tokens: 800, thoughts_tokens: 600, total_tokens: 1800,
        created_at: '', updated_at: '' },
      { date: '2026-07-02', scan_count: 5, success_count: 5, fail_count: 0, anomaly_count: 0,
        input_tokens: 500, output_tokens: 400, thoughts_tokens: 300, total_tokens: 900,
        created_at: '', updated_at: '' },
    ];
    expect(aggregateSummary(rows)).toEqual({
      scan: 15, success: 14, fail: 1, anomaly: 1, input: 1500, output: 1200, thoughts: 900, total: 2700,
    });
  });

  it('sums rows with string bigint tokens', () => {
    const rows: AiUsageRow[] = [
      { date: '2026-07-01', scan_count: 10, success_count: 10, fail_count: 0, anomaly_count: 0,
        input_tokens: '1000', output_tokens: '800', thoughts_tokens: '600', total_tokens: '1800',
        created_at: '', updated_at: '' },
    ];
    expect(aggregateSummary(rows)).toEqual({
      scan: 10, success: 10, fail: 0, anomaly: 0, input: 1000, output: 800, thoughts: 600, total: 1800,
    });
  });
});
