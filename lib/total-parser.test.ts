import { describe, it, expect } from 'vitest';
import { detectThousandsMissing } from './total-parser';

describe('detectThousandsMissing', () => {
  it('returns no-suggest when handwritten_total is null', () => {
    expect(detectThousandsMissing(null, 50000)).toEqual({ suggest: false });
  });

  it('returns no-suggest when handwritten_total is 0', () => {
    expect(detectThousandsMissing(0, 50000)).toEqual({ suggest: false });
  });

  it('returns no-suggest when computed_sum is 0', () => {
    expect(detectThousandsMissing(50, 0)).toEqual({ suggest: false });
  });

  it('returns no-suggest when handwritten_total is already >= 1000', () => {
    expect(detectThousandsMissing(50000, 50000)).toEqual({ suggest: false });
    expect(detectThousandsMissing(1500, 1500)).toEqual({ suggest: false });
  });

  it('suggests expanded total when handwritten * 1000 matches computed_sum within ±15%', () => {
    expect(detectThousandsMissing(92, 92000)).toEqual({
      suggest: true,
      suggested_total: 92000,
    });
    expect(detectThousandsMissing(92, 85000)).toEqual({
      suggest: true,
      suggested_total: 92000,
    });
    expect(detectThousandsMissing(92, 100000)).toEqual({
      suggest: true,
      suggested_total: 92000,
    });
  });

  it('does not suggest when handwritten * 1000 is outside ±15% of computed_sum', () => {
    expect(detectThousandsMissing(92, 50000)).toEqual({ suggest: false });
    expect(detectThousandsMissing(92, 200000)).toEqual({ suggest: false });
  });

  it('handles edge of tolerance band exactly at 15%', () => {
    expect(detectThousandsMissing(100, 115000)).toEqual({
      suggest: true,
      suggested_total: 100000,
    });
    expect(detectThousandsMissing(100, 85000)).toEqual({
      suggest: true,
      suggested_total: 100000,
    });
  });
});
