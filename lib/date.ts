/**
 * Business-day date helpers for Asia/Jakarta (WIB, UTC+7, no DST).
 *
 * "Business day" = warung-shift day, geser dari calendar day sebanyak
 * BUSINESS_DAY_CUTOFF_HOURS jam. Transaksi yang terjadi sebelum jam cutoff
 * dianggap masih bagian dari business day kemarin.
 *
 * Default cutoff = 12 (jam 12 siang WIB). Aman selama warung tidak buka
 * antara jam 05:00 - 17:00 WIB. Override via env NEXT_PUBLIC_BUSINESS_DAY_CUTOFF_HOURS.
 */

const WIB_OFFSET_HOURS = 7;

function readCutoffHours(): number {
  const raw = process.env.NEXT_PUBLIC_BUSINESS_DAY_CUTOFF_HOURS ?? '12';
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 23) {
    throw new Error(
      `NEXT_PUBLIC_BUSINESS_DAY_CUTOFF_HOURS must be integer 0-23, got: ${raw}`
    );
  }
  return n;
}

export const BUSINESS_DAY_CUTOFF_HOURS = readCutoffHours();

/**
 * Convert wall-clock timestamp → business date string "YYYY-MM-DD" in WIB.
 *
 * Logic: shift ts backward by CUTOFF_HOURS, then take calendar date in WIB.
 * If ts = 22 Jun 03:00 WIB and CUTOFF = 12, shifted = 21 Jun 15:00 WIB,
 * calendar date = 21 Jun.
 */
export function businessDate(ts: Date): string {
  const shiftedMs =
    ts.getTime() + (WIB_OFFSET_HOURS - BUSINESS_DAY_CUTOFF_HOURS) * 3600 * 1000;
  return new Date(shiftedMs).toISOString().slice(0, 10);
}

/**
 * Current business date in WIB.
 */
export function currentBusinessDate(): string {
  return businessDate(new Date());
}

/**
 * [start, end) UTC ISO range of `created_at` that belongs to the given business_date.
 */
export function businessDayRange(ymd: string): { start: string; end: string } {
  const cutoffHH = String(BUSINESS_DAY_CUTOFF_HOURS).padStart(2, '0');
  const startWibIso = `${ymd}T${cutoffHH}:00:00+07:00`;
  const start = new Date(startWibIso);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * [start, end) UTC ISO range spanning the whole business month "YYYY-MM".
 */
export function businessMonthRange(ym: string): { start: string; end: string } {
  const dates = businessDatesInMonth(ym);
  const firstDay = dates[0];
  const lastDay = dates[dates.length - 1];
  const { start } = businessDayRange(firstDay);
  const { end } = businessDayRange(lastDay);
  return { start, end };
}

/**
 * Inclusive list of YYYY-MM-DD business dates in the given month.
 */
export function businessDatesInMonth(ym: string): string[] {
  const [yStr, mStr] = ym.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: lastDay }, (_, i) =>
    `${ym}-${String(i + 1).padStart(2, '0')}`
  );
}

/**
 * Validate YYYY-MM-DD. Returns same string if valid, null otherwise.
 */
export function parseYmd(s: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00+07:00`);
  if (isNaN(d.getTime())) return null;
  // d is at 17:00 UTC the prior day (since midnight WIB = 17:00 UTC previous day).
  // Shift forward by 7h to land on midnight UTC of the WIB date, then read the YMD.
  // If the input was auto-corrected (e.g. '2026-02-30' → 2026-03-02), this comparison fails.
  const utcMidnightOfWibDate = new Date(d.getTime() + WIB_OFFSET_HOURS * 3600 * 1000);
  return utcMidnightOfWibDate.toISOString().slice(0, 10) === s ? s : null;
}

/**
 * Validate YYYY-MM. Returns same string if valid, null otherwise.
 */
export function parseYm(s: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(s)) return null;
  const [, mStr] = s.split('-');
  const m = parseInt(mStr, 10);
  if (m < 1 || m > 12) return null;
  return s;
}
