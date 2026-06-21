import { describe, it, expect } from 'vitest';
import { today, startOfDayWIB, endOfDayWIB, parseYmd, parseYm, monthBoundsWIB } from './date';

describe('today()', () => {
  it('returns YYYY-MM-DD string', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('startOfDayWIB', () => {
  it('returns UTC ISO at 17:00 previous day (00:00 WIB = 17:00 UTC prev)', () => {
    expect(startOfDayWIB('2026-06-15')).toBe('2026-06-14T17:00:00.000Z');
  });
});

describe('endOfDayWIB', () => {
  it('returns start of next day (exclusive upper bound)', () => {
    expect(endOfDayWIB('2026-06-15')).toBe('2026-06-15T17:00:00.000Z');
  });
});

describe('parseYmd', () => {
  it('accepts valid YYYY-MM-DD', () => {
    expect(parseYmd('2026-06-15')).toBe('2026-06-15');
  });
  it('rejects invalid format', () => {
    expect(parseYmd('2026-6-15')).toBeNull();
    expect(parseYmd('not-a-date')).toBeNull();
    expect(parseYmd('2026-13-01')).toBeNull();
  });
});

describe('parseYm', () => {
  it('accepts valid YYYY-MM', () => {
    expect(parseYm('2026-06')).toBe('2026-06');
  });
  it('rejects invalid', () => {
    expect(parseYm('2026-6')).toBeNull();
    expect(parseYm('2026-13')).toBeNull();
  });
});

describe('monthBoundsWIB', () => {
  it('returns [startOfMonth, startOfNextMonth] in UTC', () => {
    const { from, to } = monthBoundsWIB('2026-06');
    expect(from).toBe('2026-05-31T17:00:00.000Z');
    expect(to).toBe('2026-06-30T17:00:00.000Z');
  });
  it('wraps year correctly for December', () => {
    const { to } = monthBoundsWIB('2026-12');
    expect(to).toBe('2026-12-31T17:00:00.000Z');
  });
});
