/**
 * WIB (Asia/Jakarta, UTC+7, no DST) date helpers.
 * All Postgres `created_at` filters MUST use these — never inline date math.
 */

const WIB_OFFSET_HOURS = 7;

/**
 * Current date in WIB as YYYY-MM-DD.
 */
export function today(): string {
  const now = new Date();
  const wibMs = now.getTime() + WIB_OFFSET_HOURS * 3600 * 1000;
  return new Date(wibMs).toISOString().slice(0, 10);
}

/**
 * Start of given YYYY-MM-DD in WIB, as UTC ISO timestamp.
 * Use as inclusive lower bound for `created_at >= startOfDayWIB(ymd)`.
 */
export function startOfDayWIB(ymd: string): string {
  return new Date(`${ymd}T00:00:00+07:00`).toISOString();
}

/**
 * Exclusive upper bound — start of NEXT day in WIB, as UTC ISO timestamp.
 * Use as `created_at < endOfDayWIB(ymd)`.
 */
export function endOfDayWIB(ymd: string): string {
  const start = new Date(`${ymd}T00:00:00+07:00`);
  start.setUTCDate(start.getUTCDate() + 1);
  return start.toISOString();
}

/**
 * Validate YYYY-MM-DD. Returns the same string if valid, null otherwise.
 * Rejects '2026-6-15' (no zero padding), '2026-13-01' (invalid month),
 * '2026-02-30' (JS Date silently auto-corrects this to 2026-03-02).
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
 * Validate YYYY-MM. Returns the same string if valid, null otherwise.
 */
export function parseYm(s: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(s)) return null;
  const [, mStr] = s.split('-');
  const m = parseInt(mStr, 10);
  if (m < 1 || m > 12) return null;
  return s;
}

/**
 * Get [start, end) UTC bounds for a YYYY-MM in WIB.
 * start = first day of month 00:00 WIB
 * end = first day of NEXT month 00:00 WIB
 */
export function monthBoundsWIB(ym: string): { from: string; to: string } {
  const [yStr, mStr] = ym.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const fromYmd = `${ym}-01`;
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return {
    from: startOfDayWIB(fromYmd),
    to: startOfDayWIB(nextMonth),
  };
}
