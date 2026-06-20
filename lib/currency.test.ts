import { describe, it, expect } from 'vitest';
import { formatRp, parseRp } from './currency';

describe('formatRp', () => {
  it('formats zero', () => {
    expect(formatRp(0)).toBe('Rp 0');
  });
  it('formats small amount', () => {
    expect(formatRp(7000)).toBe('Rp 7.000');
  });
  it('formats six-digit amount', () => {
    expect(formatRp(222000)).toBe('Rp 222.000');
  });
  it('formats seven-digit amount', () => {
    expect(formatRp(1245000)).toBe('Rp 1.245.000');
  });
  it('handles negative (for adjustments/refunds future)', () => {
    expect(formatRp(-5000)).toBe('-Rp 5.000');
  });
});

describe('parseRp', () => {
  it('parses "Rp 7.000" → 7000', () => {
    expect(parseRp('Rp 7.000')).toBe(7000);
  });
  it('parses "Rp 1.245.000" → 1245000', () => {
    expect(parseRp('Rp 1.245.000')).toBe(1245000);
  });
  it('parses "7000" (no prefix/separator) → 7000', () => {
    expect(parseRp('7000')).toBe(7000);
  });
  it('returns NaN for invalid', () => {
    expect(parseRp('abc')).toBeNaN();
  });
});
