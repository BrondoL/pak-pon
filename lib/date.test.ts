import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BUSINESS_DAY_CUTOFF_HOURS,
  businessDate,
  currentBusinessDate,
  businessDayRange,
  businessMonthRange,
  businessDatesInMonth,
  parseYmd,
  parseYm,
} from './date';

// Default cutoff = 12. Adjust if env var changes.
describe('BUSINESS_DAY_CUTOFF_HOURS', () => {
  it('defaults to 12', () => {
    expect(BUSINESS_DAY_CUTOFF_HOURS).toBe(12);
  });
});

describe('businessDate(ts)', () => {
  // Cutoff = 12:00 WIB. Anything before 12:00 WIB → previous calendar date.
  // 21 Jun 11:59 WIB = 21 Jun 04:59 UTC
  it('returns previous calendar date for ts just before cutoff', () => {
    const ts = new Date('2026-06-21T04:59:00.000Z'); // 11:59 WIB on 21 Jun
    expect(businessDate(ts)).toBe('2026-06-20');
  });

  // 21 Jun 12:00 WIB = 21 Jun 05:00 UTC
  it('returns calendar date at cutoff boundary', () => {
    const ts = new Date('2026-06-21T05:00:00.000Z'); // exactly 12:00 WIB on 21 Jun
    expect(businessDate(ts)).toBe('2026-06-21');
  });

  // 21 Jun 23:50 WIB = 21 Jun 16:50 UTC
  it('returns same calendar date for evening ts (before midnight WIB)', () => {
    const ts = new Date('2026-06-21T16:50:00.000Z');
    expect(businessDate(ts)).toBe('2026-06-21');
  });

  // 22 Jun 00:30 WIB = 21 Jun 17:30 UTC
  it('returns previous calendar date for early-morning ts (after midnight WIB, before cutoff)', () => {
    const ts = new Date('2026-06-21T17:30:00.000Z');
    expect(businessDate(ts)).toBe('2026-06-21');
  });

  // 22 Jun 04:00 WIB = 21 Jun 21:00 UTC — still part of 21 Jun's shift
  it('returns previous calendar date for dawn ts before cutoff', () => {
    const ts = new Date('2026-06-21T21:00:00.000Z');
    expect(businessDate(ts)).toBe('2026-06-21');
  });

  // 22 Jun 11:59 WIB = 22 Jun 04:59 UTC — still part of 21 Jun's shift
  it('returns prior business date for ts just before next cutoff', () => {
    const ts = new Date('2026-06-22T04:59:00.000Z');
    expect(businessDate(ts)).toBe('2026-06-21');
  });

  // Cross-month / cross-year edge case
  it('handles month rollover', () => {
    // 1 Jul 11:59 WIB = 1 Jul 04:59 UTC → business_date = 30 Jun
    const ts = new Date('2026-07-01T04:59:00.000Z');
    expect(businessDate(ts)).toBe('2026-06-30');
  });
});

describe('currentBusinessDate()', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('uses system time and applies cutoff', () => {
    // 22 Jun 01:00 WIB = 21 Jun 18:00 UTC → still 21 Jun business
    vi.setSystemTime(new Date('2026-06-21T18:00:00.000Z'));
    expect(currentBusinessDate()).toBe('2026-06-21');
  });

  it('rolls over after cutoff', () => {
    // 22 Jun 12:01 WIB = 22 Jun 05:01 UTC → 22 Jun business
    vi.setSystemTime(new Date('2026-06-22T05:01:00.000Z'));
    expect(currentBusinessDate()).toBe('2026-06-22');
  });
});

describe('businessDayRange(businessDate)', () => {
  it('returns [start, end) UTC ISO strings spanning cutoff-to-cutoff', () => {
    // business_date 2026-06-21 with cutoff 12 →
    //   start = 21 Jun 12:00 WIB = 21 Jun 05:00 UTC
    //   end   = 22 Jun 12:00 WIB = 22 Jun 05:00 UTC
    const { start, end } = businessDayRange('2026-06-21');
    expect(start).toBe('2026-06-21T05:00:00.000Z');
    expect(end).toBe('2026-06-22T05:00:00.000Z');
  });

  it('handles month rollover', () => {
    const { start, end } = businessDayRange('2026-06-30');
    expect(start).toBe('2026-06-30T05:00:00.000Z');
    expect(end).toBe('2026-07-01T05:00:00.000Z');
  });
});

describe('businessMonthRange(ym)', () => {
  it('returns [start, end) UTC ISO spanning whole business month', () => {
    // June 2026: start = 1 Jun 12:00 WIB, end = 1 Jul 12:00 WIB
    const { start, end } = businessMonthRange('2026-06');
    expect(start).toBe('2026-06-01T05:00:00.000Z');
    expect(end).toBe('2026-07-01T05:00:00.000Z');
  });

  it('wraps year for December', () => {
    const { start, end } = businessMonthRange('2026-12');
    expect(start).toBe('2026-12-01T05:00:00.000Z');
    expect(end).toBe('2027-01-01T05:00:00.000Z');
  });
});

describe('businessDatesInMonth(ym)', () => {
  it('returns inclusive list of YYYY-MM-DD business dates', () => {
    const dates = businessDatesInMonth('2026-06');
    expect(dates).toHaveLength(30);
    expect(dates[0]).toBe('2026-06-01');
    expect(dates[29]).toBe('2026-06-30');
  });

  it('handles 31-day month', () => {
    expect(businessDatesInMonth('2026-07')).toHaveLength(31);
  });

  it('handles February (28-day non-leap)', () => {
    expect(businessDatesInMonth('2026-02')).toHaveLength(28);
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
  it('rejects auto-corrected dates', () => {
    expect(parseYmd('2026-02-30')).toBeNull();
    expect(parseYmd('2026-04-31')).toBeNull();
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
