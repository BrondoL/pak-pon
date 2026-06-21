# Shift-Aware Cut-off (Business Day) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengganti cut-off harian midnight-to-midnight dengan business-day cut-off berbasis jam, sehingga satu shift kerja warung (buka sore – tutup dini hari) tetap masuk satu business_date di laporan.

**Architecture:** Tidak ada perubahan schema DB. Logika cut-off di-encapsulate di `lib/date.ts` dengan env var `NEXT_PUBLIC_BUSINESS_DAY_CUTOFF_HOURS` (default 12). Helper baru `businessDate`, `currentBusinessDate`, `businessDayRange`, `businessMonthRange`, `businessDatesInMonth` menggantikan helpers existing yang berbasis kalender. Semua API routes & server pages yang sebelumnya filter `created_at::date` migrate ke range `created_at ∈ businessDayRange(business_date)`.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase JS client, Vitest. Tidak ada library baru.

**Spec reference:** `docs/superpowers/specs/2026-06-21-shift-cutoff-design.md`

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `lib/date.ts` | Rewrite | Sumber kebenaran tunggal untuk konversi business date / range |
| `lib/date.test.ts` | Rewrite | Unit test helpers business-day |
| `.env.example` | Modify | Tambah `NEXT_PUBLIC_BUSINESS_DAY_CUTOFF_HOURS=12` |
| `app/api/reports/daily/route.ts` | Modify | Pakai `businessDayRange` |
| `app/api/reports/monthly/route.ts` | Modify | Bucket pakai business_date dari helper, tidak inline |
| `app/api/transactions/route.ts` | Modify | Pakai `businessDayRange` |
| `app/(app)/page.tsx` | Modify | Pakai `currentBusinessDate`, label "Shift {tgl}" |
| `app/(app)/reports/daily/page.tsx` | Modify | Pakai `currentBusinessDate` + `businessDayRange` |
| `app/(app)/reports/monthly/page.tsx` | Modify | Pakai helper baru, hapus duplikasi `ymdInWIB`/`daysInMonthWIB`/`currentYmWIB` |
| `app/(app)/transactions/page.tsx` | Modify | Pakai helper baru |
| `components/daily-summary.tsx` | Modify | Default date pakai `currentBusinessDate`; render hint cut-off |
| `components/date-filter.tsx` | Modify | Default tanggal `currentBusinessDate` |
| `components/monthly-chart.tsx` | Modify | (jika perlu) reflect business_date semantik |
| `docs/superpowers/specs/2026-06-20-pak-pon-design.md` | Modify | Catat Q5 superseded; tambah env var; hapus bullet OOS yang sekarang in-scope |

---

## Task 1: Rewrite `lib/date.ts` to business-day semantics (TDD)

**Files:**
- Modify: `lib/date.ts`
- Test: `lib/date.test.ts`

- [ ] **Step 1: Write failing tests untuk semua helper baru**

Ganti **seluruh isi** `lib/date.test.ts` dengan:

```ts
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
```

- [ ] **Step 2: Run tests untuk confirm they fail**

Run: `npm run test -- lib/date.test.ts`
Expected: FAIL — banyak "is not exported", "is not a function".

- [ ] **Step 3: Rewrite `lib/date.ts`**

Ganti **seluruh isi** `lib/date.ts` dengan:

```ts
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
  // Shift ts by (WIB offset - cutoff) hours, then slice date from ISO.
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
 *
 * For business_date "2026-06-21" with cutoff 12:
 *   start = 21 Jun 12:00 WIB = 21 Jun 05:00 UTC
 *   end   = 22 Jun 12:00 WIB = 22 Jun 05:00 UTC
 */
export function businessDayRange(businessDate: string): { start: string; end: string } {
  const cutoffHH = String(BUSINESS_DAY_CUTOFF_HOURS).padStart(2, '0');
  const startWibIso = `${businessDate}T${cutoffHH}:00:00+07:00`;
  const start = new Date(startWibIso);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * [start, end) UTC ISO range spanning the whole business month "YYYY-MM".
 * start = business day 1 of month, end = business day 1 of next month.
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
 * E.g. "2026-06" → ["2026-06-01", "2026-06-02", ..., "2026-06-30"].
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
 * Rejects '2026-6-15' (no zero padding), '2026-13-01' (invalid month),
 * '2026-02-30' (JS Date silently auto-corrects).
 */
export function parseYmd(s: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00+07:00`);
  if (isNaN(d.getTime())) return null;
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
```

- [ ] **Step 4: Run tests untuk verify pass**

Run: `npm run test -- lib/date.test.ts`
Expected: PASS, all describe blocks green.

- [ ] **Step 5: Run typecheck full project**

Run: `npm run build` (atau `npx tsc --noEmit` kalau project punya — cek `package.json`)
Expected: FAIL — semua importer dari `@/lib/date` yang pakai `today`, `startOfDayWIB`, `endOfDayWIB`, `monthBoundsWIB` jadi error. Itu sinyal yang benar; tasks berikut migrate semua callers.

- [ ] **Step 6: Commit**

```bash
git add lib/date.ts lib/date.test.ts
git commit -m "feat(date): rewrite helpers to business-day semantics

Cut-off configurable via NEXT_PUBLIC_BUSINESS_DAY_CUTOFF_HOURS (default 12).
Helpers: businessDate, currentBusinessDate, businessDayRange,
businessMonthRange, businessDatesInMonth. Caller migration follows in
subsequent commits."
```

---

## Task 2: Add env var to `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Edit `.env.example`**

Tambah section baru di paling bawah file (setelah `CRON_SECRET=` block):

```
# Business day cutoff (jam WIB). Default 12 = transaksi sebelum 12:00 siang
# masuk ke business_date kemarin. Aman selama warung tidak buka jam 05:00-17:00.
NEXT_PUBLIC_BUSINESS_DAY_CUTOFF_HOURS=12
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore(env): document NEXT_PUBLIC_BUSINESS_DAY_CUTOFF_HOURS"
```

Catatan: developer harus tambahkan baris yang sama di `.env.local` mereka (gitignored). User project (deploy ke Vercel) harus `vercel env add NEXT_PUBLIC_BUSINESS_DAY_CUTOFF_HOURS` ke Production + Preview. Tidak ada task khusus — itu human ops.

---

## Task 3: Migrate `/api/reports/daily/route.ts`

**Files:**
- Modify: `app/api/reports/daily/route.ts`

- [ ] **Step 1: Replace import statement**

Ubah baris 5:

```ts
import { today, parseYmd, startOfDayWIB, endOfDayWIB } from '@/lib/date';
```

menjadi:

```ts
import { currentBusinessDate, parseYmd, businessDayRange } from '@/lib/date';
```

- [ ] **Step 2: Replace date resolution + query**

Ubah baris 27:

```ts
const date = (parsed.data.date && parseYmd(parsed.data.date)) ?? today();
```

menjadi:

```ts
const date = (parsed.data.date && parseYmd(parsed.data.date)) ?? currentBusinessDate();
```

Ubah baris 35-36:

```ts
.gte('created_at', startOfDayWIB(date))
.lt('created_at', endOfDayWIB(date));
```

menjadi:

```ts
const { start, end } = businessDayRange(date);
// ...
.gte('created_at', start)
.lt('created_at', end);
```

(Pindahkan `const { start, end } = businessDayRange(date);` ke sebelum `.from('transactions')`, lalu pakai di `.gte`/`.lt`.)

- [ ] **Step 3: Run tests (no test file for this route — typecheck only)**

Run: `npm run lint && npm run test`
Expected: PASS untuk yang relevan; lint clean.

- [ ] **Step 4: Commit**

```bash
git add app/api/reports/daily/route.ts
git commit -m "feat(api): /reports/daily uses business-day range"
```

---

## Task 4: Migrate `/api/reports/monthly/route.ts`

**Files:**
- Modify: `app/api/reports/monthly/route.ts`

- [ ] **Step 1: Replace import + drop duplicated helpers**

Hapus baris 9-28 (helper functions `currentYmWIB`, `daysInMonthWIB`, `ymdInWIB`).

Ubah baris 5:

```ts
import { parseYm, monthBoundsWIB } from '@/lib/date';
```

menjadi:

```ts
import {
  parseYm,
  businessMonthRange,
  businessDatesInMonth,
  businessDate,
  currentBusinessDate,
} from '@/lib/date';
```

Add `currentYmWIB` derived from `currentBusinessDate()`:

```ts
function currentYmWIB(): string {
  return currentBusinessDate().slice(0, 7);
}
```

(Keep ini lokal supaya simpel; alternatif: bisa extract ke lib/date.ts tapi YAGNI sekarang.)

- [ ] **Step 2: Replace query range**

Ubah baris 49:

```ts
const { from, to } = monthBoundsWIB(ym);
```

menjadi:

```ts
const { start, end } = businessMonthRange(ym);
```

Ubah baris 55-56:

```ts
.gte('created_at', from)
.lt('created_at', to);
```

menjadi:

```ts
.gte('created_at', start)
.lt('created_at', end);
```

- [ ] **Step 3: Replace bucket key calculation**

Ubah baris 70:

```ts
const day = ymdInWIB(tx.created_at);
```

menjadi:

```ts
const day = businessDate(new Date(tx.created_at));
```

- [ ] **Step 4: Replace daily fill**

Ubah baris 88:

```ts
const allDays = daysInMonthWIB(ym);
```

menjadi:

```ts
const allDays = businessDatesInMonth(ym);
```

- [ ] **Step 5: Verify build + test**

Run: `npm run test && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/reports/monthly/route.ts
git commit -m "feat(api): /reports/monthly buckets by business_date"
```

---

## Task 5: Migrate `/api/transactions/route.ts`

**Files:**
- Modify: `app/api/transactions/route.ts`

- [ ] **Step 1: Replace import**

Ubah baris 5:

```ts
import { today, parseYmd, startOfDayWIB, endOfDayWIB } from '@/lib/date';
```

menjadi:

```ts
import { currentBusinessDate, parseYmd, businessDayRange } from '@/lib/date';
```

- [ ] **Step 2: Replace date default + query range**

Ubah baris 36:

```ts
const defaultDay = today();
```

menjadi:

```ts
const defaultDay = currentBusinessDate();
```

Ubah baris 49-50:

```ts
.gte('created_at', startOfDayWIB(dateFrom))
.lt('created_at', endOfDayWIB(dateTo))
```

menjadi:

```ts
.gte('created_at', businessDayRange(dateFrom).start)
.lt('created_at', businessDayRange(dateTo).end)
```

- [ ] **Step 3: Run tests**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/transactions/route.ts
git commit -m "feat(api): /transactions filter uses business-day range"
```

---

## Task 6: Migrate Home page (`app/(app)/page.tsx`)

**Files:**
- Modify: `app/(app)/page.tsx`

- [ ] **Step 1: Replace import**

Ubah baris 5:

```ts
import { today, startOfDayWIB, endOfDayWIB } from '@/lib/date';
```

menjadi:

```ts
import { currentBusinessDate, businessDayRange } from '@/lib/date';
```

- [ ] **Step 2: Replace date resolution & query**

Ubah baris 11:

```ts
const date = today();
```

menjadi:

```ts
const date = currentBusinessDate();
const { start, end } = businessDayRange(date);
```

Ubah baris 18-19:

```ts
.gte('created_at', startOfDayWIB(date))
.lt('created_at', endOfDayWIB(date));
```

menjadi:

```ts
.gte('created_at', start)
.lt('created_at', end);
```

- [ ] **Step 3: Update header label dari "Beranda · {dateLabel}" ke "Shift · {dateLabel}"**

Ubah baris 41-42 (di dalam JSX):

```tsx
<p className="font-body text-[11px] font-medium uppercase tracking-[0.22em] text-clay">
  Beranda · {dateLabel}
</p>
```

menjadi:

```tsx
<p className="font-body text-[11px] font-medium uppercase tracking-[0.22em] text-clay">
  Shift · {dateLabel}
</p>
```

- [ ] **Step 4: Verify dev server render**

Run: `npm run dev` di background, open http://localhost:3000/, login, lihat Home.
Expected:
- Header "Shift · <hari ini WIB>" muncul
- "Ringkasan hari ini" angka konsisten (counts non-zero kalau ada data)
- Tidak ada console error

- [ ] **Step 5: Commit**

```bash
git add 'app/(app)/page.tsx'
git commit -m "feat(home): use business-day for ringkasan + 'Shift' label"
```

---

## Task 7: Migrate `/(app)/reports/daily/page.tsx`

**Files:**
- Modify: `app/(app)/reports/daily/page.tsx`

- [ ] **Step 1: Replace import**

Ubah baris 3:

```ts
import { today, parseYmd, startOfDayWIB, endOfDayWIB } from '@/lib/date';
```

menjadi:

```ts
import { currentBusinessDate, parseYmd, businessDayRange } from '@/lib/date';
```

- [ ] **Step 2: Replace date resolution + query**

Ubah baris 14:

```ts
const date = (sp.date && parseYmd(sp.date)) ?? today();
```

menjadi:

```ts
const date = (sp.date && parseYmd(sp.date)) ?? currentBusinessDate();
```

Ubah baris 20-21:

```ts
.gte('created_at', startOfDayWIB(date))
.lt('created_at', endOfDayWIB(date));
```

menjadi:

```ts
const { start, end } = businessDayRange(date);
// ...
.gte('created_at', start)
.lt('created_at', end);
```

(Pindahkan `const { start, end }` ke sebelum `.from('transactions')`.)

- [ ] **Step 3: Verify dev render**

Run: `npm run dev`, open http://localhost:3000/reports/daily
Expected: Page render tanpa error, angka konsisten.

- [ ] **Step 4: Commit**

```bash
git add 'app/(app)/reports/daily/page.tsx'
git commit -m "feat(reports/daily): use business-day range"
```

---

## Task 8: Migrate `components/daily-summary.tsx`

**Files:**
- Modify: `components/daily-summary.tsx`

- [ ] **Step 1: Replace import**

Ubah baris 9:

```ts
import { today } from '@/lib/date';
```

menjadi:

```ts
import { currentBusinessDate, BUSINESS_DAY_CUTOFF_HOURS } from '@/lib/date';
```

- [ ] **Step 2: Replace `today()` calls**

`grep -n "today()" components/daily-summary.tsx` → replace each `today()` dengan `currentBusinessDate()`.

(Default tanggal di date picker, "Hari ini" link, dst.)

- [ ] **Step 3: Render cut-off hint**

Tambah di akhir JSX (sebelum closing tag) — kecil, di footer card atau di bawah angka total. Find existing element terdekat (misal end of `<Card>` summary), lalu insert:

```tsx
<p className="mt-2 text-[10px] text-clay/70">
  Catatan: closingan 1 hari = transaksi sejak jam{' '}
  {String(BUSINESS_DAY_CUTOFF_HOURS).padStart(2, '0')}:00 WIB tanggal pilihan
  sampai 11:59 siang besoknya.
</p>
```

(Exact placement: insert di dalam header Card yang punya "Closingan harian", sebelum `</Card>`. Lihat file untuk kontainer yang relevan; satu hint cukup, tidak per-section.)

- [ ] **Step 4: Verify**

Run: `npm run dev`, buka `/reports/daily`, lihat hint muncul.
Expected: text muncul, format "12:00 WIB" (dengan default cutoff).

- [ ] **Step 5: Commit**

```bash
git add components/daily-summary.tsx
git commit -m "feat(daily-summary): default ke currentBusinessDate + tampilkan cutoff hint"
```

---

## Task 9: Migrate `/(app)/reports/monthly/page.tsx` + `components/monthly-chart.tsx`

**Files:**
- Modify: `app/(app)/reports/monthly/page.tsx`
- Modify: `components/monthly-chart.tsx`

- [ ] **Step 1: Replace import & hapus duplicate helpers di server page**

Ubah baris 3:

```ts
import { parseYm, monthBoundsWIB } from '@/lib/date';
```

menjadi:

```ts
import {
  parseYm,
  businessMonthRange,
  businessDate,
  businessDatesInMonth,
  currentBusinessDate,
} from '@/lib/date';
```

Hapus helper duplikat baris 9-28 (`currentYmWIB`, `daysInMonthWIB`, `ymdInWIB`).

Tambah pengganti tipis:

```ts
function currentYm(): string {
  return currentBusinessDate().slice(0, 7);
}
```

- [ ] **Step 2: Replace query range**

Ubah baris 32:

```ts
const ym = (sp.ym && parseYm(sp.ym)) ?? currentYmWIB();
```

menjadi:

```ts
const ym = (sp.ym && parseYm(sp.ym)) ?? currentYm();
```

Ubah baris 39:

```ts
const { from, to } = monthBoundsWIB(ym);
```

menjadi:

```ts
const { start, end } = businessMonthRange(ym);
```

Ubah `.gte('created_at', from)` → `.gte('created_at', start)`, `.lt('created_at', to)` → `.lt('created_at', end)`.

- [ ] **Step 3: Replace bucket key**

Ubah baris 54:

```ts
const day = ymdInWIB(tx.created_at);
```

menjadi:

```ts
const day = businessDate(new Date(tx.created_at));
```

- [ ] **Step 4: Replace fill helper**

Ubah baris 73:

```ts
const daily = daysInMonthWIB(ym).map((date) => {
```

menjadi:

```ts
const daily = businessDatesInMonth(ym).map((date) => {
```

- [ ] **Step 5: Cek `components/monthly-chart.tsx` untuk import dari @/lib/date**

Run: `grep -n "@/lib/date" components/monthly-chart.tsx`

Kalau import `today` atau `startOfDayWIB`/`endOfDayWIB`/`monthBoundsWIB`, ganti sesuai pola Task 6/8. Kalau hanya impor untuk fungsi yang tetap ada (`parseYmd`/`parseYm`), tidak perlu ubah.

- [ ] **Step 6: Verify dev render**

Run: `npm run dev`, open http://localhost:3000/reports/monthly
Expected: Chart render dengan bar per business_date, total bulan benar.

- [ ] **Step 7: Commit**

```bash
git add 'app/(app)/reports/monthly/page.tsx' components/monthly-chart.tsx
git commit -m "feat(reports/monthly): bucket by business_date"
```

---

## Task 10: Migrate `/(app)/transactions/page.tsx` + `components/date-filter.tsx`

**Files:**
- Modify: `app/(app)/transactions/page.tsx`
- Modify: `components/date-filter.tsx`

- [ ] **Step 1: Cek import di transactions page**

Run: `grep -n "@/lib/date" 'app/(app)/transactions/page.tsx'`

Kalau pakai `today`/`startOfDayWIB`/`endOfDayWIB`/`monthBoundsWIB`, ganti sesuai pola yang sama:
- `today()` → `currentBusinessDate()`
- `startOfDayWIB(d)` → `businessDayRange(d).start`
- `endOfDayWIB(d)` → `businessDayRange(d).end`
- Import statement disesuaikan

- [ ] **Step 2: Cek import di date-filter component**

Run: `grep -n "@/lib/date" components/date-filter.tsx`

Ganti dengan pola yang sama. Default value date picker = `currentBusinessDate()`.

- [ ] **Step 3: Verify dev render**

Run: `npm run dev`, buka `/transactions`
Expected:
- Default filter date range = business date hari ini
- List tampilkan `created_at` apa adanya (jam fisik transaksi)
- Tidak ada console error

- [ ] **Step 4: Commit**

```bash
git add 'app/(app)/transactions/page.tsx' components/date-filter.tsx
git commit -m "feat(transactions): filter pakai business-day semantics"
```

---

## Task 11: Update main design spec

**Files:**
- Modify: `docs/superpowers/specs/2026-06-20-pak-pon-design.md`

- [ ] **Step 1: Mark Q5 superseded**

Cari row di Section 3 (Key decisions) yang mention "Cut-off harian: Midnight-to-midnight (23:59 WIB)". Ubah kolom Implikasi menjadi:

```
~Superseded oleh 2026-06-21-shift-cutoff-design.md — sekarang business-day berbasis env var.~
```

(Atau pakai cara markup lain yang konsisten dengan dokumen — tag "(updated)" + link).

- [ ] **Step 2: Tambah env var**

Section 11 "Env vars" table — tambah baris:

```
| `NEXT_PUBLIC_BUSINESS_DAY_CUTOFF_HOURS` | client+server | jam cut-off business-day (default 12) |
```

- [ ] **Step 3: Update bullet OOS**

Section 15 "Out of scope (MVP)" — hapus bullet:

```
- Buka warung lewat tengah malam (B option di Q5) — sekarang midnight-to-midnight
```

- [ ] **Step 4: Update Section 14 Conventions**

Tambah bullet:

```
- **Business day**: pakai `currentBusinessDate()` / `businessDayRange()` dari `lib/date.ts`; jangan inline `created_at::date`
```

- [ ] **Step 5: Update US-2 acceptance criteria**

Cari "Cut-off harian: midnight-to-midnight (00:00–23:59 WIB)" dan ganti dengan:

```
- Cut-off harian: business-day, default jam 12:00 WIB (env `NEXT_PUBLIC_BUSINESS_DAY_CUTOFF_HOURS`)
```

- [ ] **Step 6: Final verification — full app smoke test**

Run: `npm run lint && npm run test && npm run build`
Expected: ALL PASS.

Then `npm run dev` dan klik through:
- `/` → header "Shift · …", angka ringkasan
- `/reports/daily` → angka closingan + cut-off hint
- `/reports/daily?date=YYYY-MM-DD` → tanggal historis
- `/reports/monthly` → chart 30+ bar, total bulan
- `/transactions` → list default = business date hari ini
- Lakukan 1 scan dummy (kalau gampang) atau ambil transaksi pending → verify created_at di display

Expected: semua angka konsisten, tidak ada console error.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-06-20-pak-pon-design.md
git commit -m "docs: mark Q5 superseded by shift cutoff design

Updates main spec: env var, conventions, OOS bullet, US-2 acceptance."
```

---

## Self-Review

### Spec coverage

- §4 Konsep business day → Task 1 (helper)
- §5 Konfigurasi env var → Task 1 (validation) + Task 2 (.env.example)
- §6 Helper module → Task 1
- §7 Query strategy (daily, monthly, top items) → Task 3, 4, 5
- §8 API contract (daily, monthly, transactions) → Task 3, 4, 5
- §9 UI changes (Home, daily, monthly, transactions, hint) → Task 6, 7, 8, 9, 10
- §10 No backfill → confirmed (no migration tasks)
- §11 Testing → Task 1 covers unit tests; integration test (seed transactions di beberapa jam, verify endpoint) — **NOT in plan as a separate task**. Reason: project belum punya integration test setup yang nyata untuk API routes; unit test helper + manual dev smoke test (Task 11 step 6) cukup untuk MVP. Tambah integration test sebagai follow-up kalau test infra di-formalize.
- §12 OOS → confirmed (no task untuk shifts table, manual tombol, dll)
- §13 Update main spec → Task 11

### Placeholder scan

- ✅ Tidak ada "TBD" / "TODO" / "implement later"
- ✅ Setiap step yang ubah kode punya code block lengkap atau diff explicit
- ✅ Setiap step yang run command punya command exact + expected output

### Type consistency

- `BUSINESS_DAY_CUTOFF_HOURS` (constant), `businessDate(ts: Date): string`, `currentBusinessDate(): string`, `businessDayRange(s: string): { start: string; end: string }`, `businessMonthRange(s: string): { start: string; end: string }`, `businessDatesInMonth(s: string): string[]` — konsisten di semua tasks.
- Note: spec section 6 awalnya sebutkan `Date` untuk return of businessDayRange; plan switch ke `string` (ISO UTC) untuk match existing Supabase query pattern (callers do `.gte('created_at', start)`). Plan ini lebih akurat untuk codebase; spec section 6 bisa update setelah implement kalau perlu — atau biarkan spec sebagai high-level intent.
