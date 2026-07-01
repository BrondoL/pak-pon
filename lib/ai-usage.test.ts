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

import { recordUsageDaily } from './ai-usage';

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
      attempts: [{ input_tokens: 500, output_tokens: 100, total_tokens: 600 }],
      failed: false,
    });
    expect(mockRpc).toHaveBeenCalledWith('increment_ai_usage_daily', {
      p_date: '2026-07-02',
      p_scan: 1,
      p_success: 1,
      p_fail: 0,
      p_input: 500,
      p_output: 100,
      p_total: 600,
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
      p_input: 1089,
      p_output: 0,
      p_total: 1089,
    }));
  });

  it('sums multiple attempts (retry scenario) — hypothetical multi-attempt', async () => {
    await recordUsageDaily({
      attempts: [
        { input_tokens: 500, output_tokens: 100, total_tokens: 600 },
        { input_tokens: 500, output_tokens: 120, total_tokens: 620 },
      ],
      failed: false,
    });
    expect(mockRpc).toHaveBeenCalledWith('increment_ai_usage_daily', expect.objectContaining({
      p_input: 1000,
      p_output: 220,
      p_total: 1220,
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
