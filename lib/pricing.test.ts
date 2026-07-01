import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('estimateCostIdr', () => {
  beforeEach(() => {
    vi.stubEnv('GEMINI_INPUT_RATE_USD_PER_1M', '0.30');
    vi.stubEnv('GEMINI_OUTPUT_RATE_USD_PER_1M', '2.50');
    vi.stubEnv('USD_IDR_RATE', '16000');
    vi.resetModules();
  });

  it('returns 0 for zero tokens', async () => {
    const { estimateCostIdr } = await import('./pricing');
    expect(estimateCostIdr(0, 0)).toBe(0);
  });

  it('computes IDR: 1M input tok = 0.30 USD × 16000 = 4800 IDR', async () => {
    const { estimateCostIdr } = await import('./pricing');
    expect(estimateCostIdr(1_000_000, 0)).toBe(4800);
  });

  it('computes IDR: 1M output tok = 2.50 USD × 16000 = 40000 IDR', async () => {
    const { estimateCostIdr } = await import('./pricing');
    expect(estimateCostIdr(0, 1_000_000)).toBe(40000);
  });

  it('sums input+output correctly and rounds', async () => {
    const { estimateCostIdr } = await import('./pricing');
    // 1500 tok input + 200 tok output
    // = (1500 * 0.30 + 200 * 2.50) / 1e6 * 16000
    // = (450 + 500) / 1e6 * 16000 = 950e-6 * 16000 = 15.2 → round → 15
    expect(estimateCostIdr(1500, 200)).toBe(15);
  });
});
