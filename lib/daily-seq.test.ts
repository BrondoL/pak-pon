import { describe, it, expect } from 'vitest';
import { computeNextDailySeq } from './daily-seq';

describe('computeNextDailySeq', () => {
  it('returns 1 when no existing seq in business day', () => {
    expect(computeNextDailySeq([])).toBe(1);
  });

  it('returns max + 1 from existing seqs', () => {
    expect(computeNextDailySeq([1, 2, 3])).toBe(4);
  });

  it('ignores null seqs (pending_review tx)', () => {
    expect(computeNextDailySeq([1, null, 2, null])).toBe(3);
  });

  it('handles non-contiguous seqs (e.g. soft-deleted gaps)', () => {
    expect(computeNextDailySeq([1, 5, 7])).toBe(8);
  });
});
