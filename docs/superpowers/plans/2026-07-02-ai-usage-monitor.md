# AI Usage Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track OCR token usage per hari (WIB) di Supabase, tampilkan di halaman `/setup/ai-usage` (chart + tabel + estimasi biaya IDR), akses via dropdown gear icon di navbar.

**Architecture:** `POST /api/scan` finally block memanggil `recordUsageDaily()` helper best-effort → RPC `increment_ai_usage_daily` atomic upsert ke tabel `ai_usage_daily` (PK `date`). Page server component fetch 30-day slice → render summary card + recharts BarChart + tabel harian. Rate Gemini → IDR di-compute di app pakai env var.

**Tech Stack:** Next.js 16 App Router, Supabase (@supabase/ssr), TypeScript, Vitest (jsdom), Recharts 3.9, shadcn/ui, Tailwind v4.

**Spec reference:** [`docs/superpowers/specs/2026-07-02-ai-usage-monitor-design.md`](../specs/2026-07-02-ai-usage-monitor-design.md)

---

## Task 1: Migration — table `ai_usage_daily` + RPC

**Files:**
- Create: `supabase/migrations/0028_ai_usage_daily.sql`

**Context:**
- Function `set_updated_at()` sudah ada di `supabase/migrations/0001_schema.sql:46`.
- Project pakai Supabase CLI push (no local `config.toml`). Test migrasi = paste ke Supabase SQL editor / `supabase db push`.

- [ ] **Step 1: Create migration file**

Path: `supabase/migrations/0028_ai_usage_daily.sql`

```sql
-- Track daily OCR (Gemini) token usage. 1 row per hari WIB (via businessDate).
-- Populated best-effort dari /api/scan finally block via RPC increment_ai_usage_daily.

CREATE TABLE ai_usage_daily (
  date            date PRIMARY KEY,
  scan_count      integer NOT NULL DEFAULT 0,
  success_count   integer NOT NULL DEFAULT 0,
  fail_count      integer NOT NULL DEFAULT 0,
  input_tokens    bigint  NOT NULL DEFAULT 0,
  output_tokens   bigint  NOT NULL DEFAULT 0,
  total_tokens    bigint  NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_usage_daily_date_desc ON ai_usage_daily (date DESC);

CREATE TRIGGER ai_usage_daily_touch
  BEFORE UPDATE ON ai_usage_daily
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION increment_ai_usage_daily(
  p_date    date,
  p_scan    integer,
  p_success integer,
  p_fail    integer,
  p_input   bigint,
  p_output  bigint,
  p_total   bigint
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO ai_usage_daily (
    date, scan_count, success_count, fail_count,
    input_tokens, output_tokens, total_tokens
  ) VALUES (
    p_date, p_scan, p_success, p_fail, p_input, p_output, p_total
  )
  ON CONFLICT (date) DO UPDATE SET
    scan_count    = ai_usage_daily.scan_count    + EXCLUDED.scan_count,
    success_count = ai_usage_daily.success_count + EXCLUDED.success_count,
    fail_count    = ai_usage_daily.fail_count    + EXCLUDED.fail_count,
    input_tokens  = ai_usage_daily.input_tokens  + EXCLUDED.input_tokens,
    output_tokens = ai_usage_daily.output_tokens + EXCLUDED.output_tokens,
    total_tokens  = ai_usage_daily.total_tokens  + EXCLUDED.total_tokens,
    updated_at    = now();
END;
$$;

ALTER TABLE ai_usage_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_usage_daily_read ON ai_usage_daily
  FOR SELECT USING (auth.role() = 'authenticated');
```

- [ ] **Step 2: Apply migration ke Supabase project**

Run: `supabase db push` (kalau CLI ter-link) atau paste SQL ke Supabase Studio SQL Editor.

Expected: `CREATE TABLE`, `CREATE INDEX`, `CREATE TRIGGER`, `CREATE FUNCTION`, `ALTER TABLE`, `CREATE POLICY` all succeed. Tabel `ai_usage_daily` muncul di Table Editor.

- [ ] **Step 3: Verify RPC works**

Di Supabase SQL Editor jalankan:
```sql
SELECT increment_ai_usage_daily('2026-07-02', 1, 1, 0, 500, 100, 600);
SELECT increment_ai_usage_daily('2026-07-02', 1, 0, 1, 500, 0, 500);
SELECT * FROM ai_usage_daily WHERE date = '2026-07-02';
```

Expected: 1 row dengan `scan_count=2, success_count=1, fail_count=1, input_tokens=1000, output_tokens=100, total_tokens=1100`.

Cleanup:
```sql
DELETE FROM ai_usage_daily WHERE date = '2026-07-02';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0028_ai_usage_daily.sql
git commit -m "feat(ocr): add ai_usage_daily table + increment RPC"
```

---

## Task 2: `lib/pricing.ts` + test

**Files:**
- Create: `lib/pricing.ts`
- Create: `lib/pricing.test.ts`

**Context:** Rate default = Gemini 3.5 Flash saat design (input $0.30/1M, output $2.50/1M, USD-IDR 16000). Bisa override via env di Vercel.

- [ ] **Step 1: Write failing test**

Path: `lib/pricing.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('estimateCostIdr', () => {
  beforeEach(() => {
    // Ensure fallback defaults (env unset)
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/pricing.test.ts`
Expected: FAIL — "Cannot find module './pricing'".

- [ ] **Step 3: Implement `lib/pricing.ts`**

Path: `lib/pricing.ts`

```ts
function num(envKey: string, fallback: string): number {
  const raw = process.env[envKey] ?? fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number(fallback);
}

export function estimateCostIdr(inputTokens: number, outputTokens: number): number {
  const inputUsdPer1M = num('GEMINI_INPUT_RATE_USD_PER_1M', '0.30');
  const outputUsdPer1M = num('GEMINI_OUTPUT_RATE_USD_PER_1M', '2.50');
  const usdIdr = num('USD_IDR_RATE', '16000');
  const usd = (inputTokens * inputUsdPer1M + outputTokens * outputUsdPer1M) / 1_000_000;
  return Math.round(usd * usdIdr);
}

export function pricingSnapshot() {
  return {
    inputUsdPer1M: num('GEMINI_INPUT_RATE_USD_PER_1M', '0.30'),
    outputUsdPer1M: num('GEMINI_OUTPUT_RATE_USD_PER_1M', '2.50'),
    usdIdr: num('USD_IDR_RATE', '16000'),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/pricing.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pricing.ts lib/pricing.test.ts
git commit -m "feat(ocr): add env-based Gemini pricing → IDR estimator"
```

---

## Task 3: `lib/ai-usage.ts` recordUsageDaily + tests

**Files:**
- Create: `lib/ai-usage.ts`
- Create: `lib/ai-usage.test.ts`

**Context:**
- `getSupabaseServer` di `@/lib/supabase/server` returns Promise<SupabaseClient>.
- `businessDate(ts: Date)` di `@/lib/date` returns 'YYYY-MM-DD' WIB dengan business-day cutoff.

- [ ] **Step 1: Write failing tests**

Path: `lib/ai-usage.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
const mockClient = { rpc: mockRpc };

vi.mock('./supabase/server', () => ({
  getSupabaseServer: vi.fn().mockResolvedValue(mockClient),
}));

vi.mock('./date', () => ({
  businessDate: vi.fn().mockReturnValue('2026-07-02'),
}));

// Import after mocks are set up
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
    // Simulasi kalau future retry logic dihidupkan lagi
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- lib/ai-usage.test.ts`
Expected: FAIL — "Cannot find module './ai-usage'".

- [ ] **Step 3: Implement `lib/ai-usage.ts`**

Path: `lib/ai-usage.ts`

```ts
import { getSupabaseServer } from './supabase/server';
import { businessDate } from './date';

export type Attempt = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

export type RecordUsageArgs = {
  attempts: Attempt[];
  failed: boolean;
  requestStartedAt?: Date;
};

export type AiUsageRow = {
  date: string;
  scan_count: number;
  success_count: number;
  fail_count: number;
  input_tokens: number | string;
  output_tokens: number | string;
  total_tokens: number | string;
  created_at: string;
  updated_at: string;
};

export async function recordUsageDaily(args: RecordUsageArgs): Promise<void> {
  try {
    if (!args.attempts?.length) return;

    const input = args.attempts.reduce((s, a) => s + (a.input_tokens ?? 0), 0);
    const output = args.attempts.reduce((s, a) => s + (a.output_tokens ?? 0), 0);
    const total = args.attempts.reduce((s, a) => s + (a.total_tokens ?? 0), 0);
    if (input === 0 && output === 0) return;

    const dateWIB = businessDate(args.requestStartedAt ?? new Date());
    const supabase = await getSupabaseServer();
    const { error } = await supabase.rpc('increment_ai_usage_daily', {
      p_date: dateWIB,
      p_scan: 1,
      p_success: args.failed ? 0 : 1,
      p_fail: args.failed ? 1 : 0,
      p_input: input,
      p_output: output,
      p_total: total,
    });
    if (error) console.warn('[ai-usage] upsert failed', error);
  } catch (err) {
    console.warn('[ai-usage] recordUsageDaily threw', err);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- lib/ai-usage.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ai-usage.ts lib/ai-usage.test.ts
git commit -m "feat(ocr): add recordUsageDaily best-effort helper"
```

---

## Task 4: `aggregateSummary` helper + test

**Files:**
- Modify: `lib/ai-usage.ts` (append)
- Modify: `lib/ai-usage.test.ts` (append)

**Context:** `bigint` dari `supabase-js` bisa datang sebagai `string` di JSON. Cast defensif via `Number()`.

- [ ] **Step 1: Write failing test (append to ai-usage.test.ts)**

Append ke `lib/ai-usage.test.ts`. Tambah dua import di **top of file** (dekat dengan `import { recordUsageDaily } from './ai-usage';`):

```ts
import { aggregateSummary } from './ai-usage';
import type { AiUsageRow } from './ai-usage';
```

Kemudian append describe block:

```ts
describe('aggregateSummary', () => {
  it('returns zeros for empty array', () => {
    expect(aggregateSummary([])).toEqual({
      scan: 0, success: 0, fail: 0, input: 0, output: 0, total: 0,
    });
  });

  it('sums rows with number tokens', () => {
    const rows: AiUsageRow[] = [
      { date: '2026-07-01', scan_count: 10, success_count: 9, fail_count: 1,
        input_tokens: 1000, output_tokens: 200, total_tokens: 1200,
        created_at: '', updated_at: '' },
      { date: '2026-07-02', scan_count: 5, success_count: 5, fail_count: 0,
        input_tokens: 500, output_tokens: 100, total_tokens: 600,
        created_at: '', updated_at: '' },
    ];
    expect(aggregateSummary(rows)).toEqual({
      scan: 15, success: 14, fail: 1, input: 1500, output: 300, total: 1800,
    });
  });

  it('sums rows with string bigint tokens', () => {
    const rows: AiUsageRow[] = [
      { date: '2026-07-01', scan_count: 10, success_count: 10, fail_count: 0,
        input_tokens: '1000', output_tokens: '200', total_tokens: '1200',
        created_at: '', updated_at: '' },
    ];
    expect(aggregateSummary(rows)).toEqual({
      scan: 10, success: 10, fail: 0, input: 1000, output: 200, total: 1200,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/ai-usage.test.ts`
Expected: FAIL — "aggregateSummary is not exported".

- [ ] **Step 3: Append `aggregateSummary` to `lib/ai-usage.ts`**

Append:

```ts
export type UsageSummary = {
  scan: number;
  success: number;
  fail: number;
  input: number;
  output: number;
  total: number;
};

export function aggregateSummary(rows: AiUsageRow[]): UsageSummary {
  return rows.reduce<UsageSummary>(
    (acc, r) => ({
      scan: acc.scan + r.scan_count,
      success: acc.success + r.success_count,
      fail: acc.fail + r.fail_count,
      input: acc.input + Number(r.input_tokens),
      output: acc.output + Number(r.output_tokens),
      total: acc.total + Number(r.total_tokens),
    }),
    { scan: 0, success: 0, fail: 0, input: 0, output: 0, total: 0 }
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- lib/ai-usage.test.ts`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add lib/ai-usage.ts lib/ai-usage.test.ts
git commit -m "feat(ocr): add aggregateSummary helper for AI usage rows"
```

---

## Task 5: Hook recordUsageDaily in `/api/scan` finally block

**Files:**
- Modify: `app/api/scan/route.ts:11-13, 192-194`

**Context:**
- Existing finally block cuma `evt.emit()` di line 193.
- `ocrMeta.attempts` sudah tersedia di line 79.
- `ocrMeta.final_model === null` di-emit di line 84 sebagai `ocr_total_failure`.

Empat perubahan berurutan di `app/api/scan/route.ts`. `ocrMeta` sekarang harus visible di `finally` block, jadi harus dideklarasi di luar try.

- [ ] **Step 1: Add import**

Add after existing `import { newEvent, tagStatus } from '@/lib/logger';` (currently line 5):

```ts
import { recordUsageDaily } from '@/lib/ai-usage';
```

- [ ] **Step 2: Lift `ocrMeta` + `requestStartedAt` out of try block**

Change top of `POST` function (currently lines 11-13):

**Before:**
```ts
export async function POST(request: NextRequest) {
  const evt = newEvent('POST /api/scan');
  try {
```

**After:**
```ts
export async function POST(request: NextRequest) {
  const evt = newEvent('POST /api/scan');
  const requestStartedAt = new Date();
  let ocrMeta: Awaited<ReturnType<typeof scanNota>>['meta'] | undefined;
  try {
```

- [ ] **Step 3: Change destructuring pattern for `scanNota` result**

Change `scanNota` call (currently line 79):

**Before:**
```ts
const { result: ocr, meta: ocrMeta } = await scanNota(base64, 'image/jpeg', menus);
```

**After:**
```ts
const { result: ocr, meta } = await scanNota(base64, 'image/jpeg', menus);
ocrMeta = meta;
```

Semua reference `ocrMeta` di baris selanjutnya (line 81-89, 184) sudah menunjuk ke `let` di outer scope — no rename needed.

- [ ] **Step 4: Extend finally block**

Change finally block (currently lines 192-194):

**Before:**
```ts
} finally {
  evt.emit();
}
```

**After:**
```ts
} finally {
  evt.emit();
  if (ocrMeta) {
    await recordUsageDaily({
      attempts: ocrMeta.attempts,
      failed: ocrMeta.final_model === null,
      requestStartedAt,
    });
  }
}
```

`recordUsageDaily` sudah swallow errors internally (per Task 3), jadi tidak perlu try/catch tambahan di sini.

- [ ] **Step 5: Verify build + tests**

Run: `npm run test -- lib/ai-usage.test.ts`
Expected: still PASS.

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 6: Commit**

```bash
git add app/api/scan/route.ts
git commit -m "feat(ocr): persist per-day token usage after scan"
```

---

## Task 6: Install shadcn dropdown-menu component

**Files:**
- Create: `components/ui/dropdown-menu.tsx` (via CLI)

**Context:** `components/ui/` sudah punya dialog, alert-dialog, button, card, dll — semua via shadcn CLI. Install pattern konsisten.

- [ ] **Step 1: Run shadcn add**

Run: `npx shadcn@latest add dropdown-menu`

Expected: File `components/ui/dropdown-menu.tsx` dibuat. CLI mungkin nambah dep `@radix-ui/react-dropdown-menu` di `package.json` — biarin, itu part of install.

- [ ] **Step 2: Verify file exists**

Run: `ls components/ui/dropdown-menu.tsx`
Expected: file listed.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 4: Commit**

```bash
git add components/ui/dropdown-menu.tsx package.json package-lock.json
git commit -m "chore(ui): add shadcn dropdown-menu component"
```

---

## Task 7: Refactor navbar gear icon → dropdown menu (client sub-component)

**Files:**
- Create: `components/setup-menu.tsx`
- Modify: `components/nav.tsx:52-62`

**Context:** `components/nav.tsx` adalah server component. DropdownMenu = client (radix). Extract dropdown ke client component supaya `nav.tsx` tetap server.

- [ ] **Step 1: Create `components/setup-menu.tsx`**

Path: `components/setup-menu.tsx`

```tsx
'use client';

import Link from 'next/link';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function SetupMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Setup"
          title="Setup"
          className="ml-0.5 inline-flex h-9 w-9 items-center justify-center rounded-md text-ink transition-colors duration-[var(--duration-fast)] hover:bg-night-soft hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-night sm:ml-1"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem asChild>
          <Link href="/setup/printer/settings">Setting Printer</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/setup/ai-usage">AI Usage</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Replace gear icon Link in `components/nav.tsx`**

Modify `components/nav.tsx`:

Delete lines 52-62 (the existing `<Link href="/setup/printer/settings">...` block with the gear SVG).

Replace with:
```tsx
<SetupMenu />
```

Add import at top:
```tsx
import { SetupMenu } from './setup-menu';
```

- [ ] **Step 3: Build to catch TS/import errors**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 4: Manual smoke — dev server**

Run: `npm run dev`
Open: `http://localhost:3000/scan` (or any authed page).
Verify:
- Gear icon still visible di navbar (kanan).
- Klik gear → dropdown muncul dengan 2 entries: "Setting Printer" & "AI Usage".
- Klik "Setting Printer" → navigate ke `/setup/printer/settings` (harus kerja seperti sebelumnya).
- Klik "AI Usage" → navigate ke `/setup/ai-usage` (akan 404 sampai Task 8 selesai — OK expected).

Stop dev server (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add components/nav.tsx components/setup-menu.tsx
git commit -m "feat(nav): convert setup gear icon to dropdown menu"
```

---

## Task 8: Create `/setup/ai-usage` page shell (server component)

**Files:**
- Create: `app/(app)/setup/ai-usage/page.tsx`

**Context:**
- `page.tsx` di printer settings pakai `export const dynamic = 'force-dynamic';` + async server component.
- Menggunakan `businessDate`, `businessDatesInMonth` dari `@/lib/date`.

- [ ] **Step 1: Create page.tsx (shell only, chart & table components stubbed)**

Path: `app/(app)/setup/ai-usage/page.tsx`

```tsx
import { getSupabaseServer } from '@/lib/supabase/server';
import { currentBusinessDate } from '@/lib/date';
import { aggregateSummary, type AiUsageRow } from '@/lib/ai-usage';
import { SummaryCard } from './summary-card';
import { AiUsageChart } from './ai-usage-chart';
import { AiUsageTable } from './ai-usage-table';

export const dynamic = 'force-dynamic';

function subtractDays(ymd: string, n: number): string {
  // ymd = 'YYYY-MM-DD'. Kurangi n hari kalender, return YYYY-MM-DD.
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function firstDayOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

function monthLabel(ymd: string): string {
  // 'Juli 2026'
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.toLocaleString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export default async function AiUsagePage() {
  const supabase = await getSupabaseServer();
  const today = currentBusinessDate();
  const thirtyDaysAgo = subtractDays(today, 29);
  const monthStart = firstDayOfMonth(today);

  const { data } = await supabase
    .from('ai_usage_daily')
    .select('*')
    .gte('date', thirtyDaysAgo)
    .order('date', { ascending: false });

  const rows = (data ?? []) as AiUsageRow[];
  const monthRows = rows.filter((r) => r.date >= monthStart);
  const summary = aggregateSummary(monthRows);
  const chartRows = [...rows].reverse(); // ascending untuk chart

  return (
    <div className="mx-auto max-w-4xl p-4 space-y-6">
      <div>
        <h1 className="font-display text-2xl text-coal">AI Usage</h1>
        <p className="mt-1 text-sm text-coal-soft">
          Konsumsi token OCR Gemini per hari (WIB business-day). Data mulai
          tercatat sejak fitur ini dirilis.
        </p>
      </div>
      <SummaryCard summary={summary} monthLabel={monthLabel(today)} />
      <AiUsageChart rows={chartRows} />
      <AiUsageTable rows={rows} today={today} />
    </div>
  );
}
```

**Note**: Ini akan gagal build sampai Task 9-11 buat 3 komponen stub. Jalur simple: bikin file stubs dulu sebelum build.

- [ ] **Step 2: Create 3 stub files supaya build tidak error**

Path: `app/(app)/setup/ai-usage/summary-card.tsx`

```tsx
import type { UsageSummary } from '@/lib/ai-usage';

export function SummaryCard({ summary, monthLabel }: { summary: UsageSummary; monthLabel: string }) {
  return <div>TODO summary {monthLabel} scan={summary.scan}</div>;
}
```

Path: `app/(app)/setup/ai-usage/ai-usage-chart.tsx`

```tsx
'use client';
import type { AiUsageRow } from '@/lib/ai-usage';

export function AiUsageChart({ rows }: { rows: AiUsageRow[] }) {
  return <div>TODO chart {rows.length} rows</div>;
}
```

Path: `app/(app)/setup/ai-usage/ai-usage-table.tsx`

```tsx
'use client';
import type { AiUsageRow } from '@/lib/ai-usage';

export function AiUsageTable({ rows, today }: { rows: AiUsageRow[]; today: string }) {
  return <div>TODO table {rows.length} rows, today={today}</div>;
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 4: Manual smoke**

Run: `npm run dev`
Navigate to `http://localhost:3000/setup/ai-usage`.
Expected: page loads with title "AI Usage", 3 TODO placeholder blocks. No console errors.

Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/setup/ai-usage/
git commit -m "feat(ai-usage): scaffold /setup/ai-usage page shell + stubs"
```

---

## Task 9: Implement `SummaryCard`

**Files:**
- Modify: `app/(app)/setup/ai-usage/summary-card.tsx`

**Context:**
- Import `formatRp` dari `@/lib/currency` (signature: `formatRp(amount: number): string`).
- Compact number formatting via `Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 })`.
- `estimateCostIdr` dari `@/lib/pricing`.
- Design tokens: pakai `text-coal`, `text-coal-soft`, `border`, dll (existing convention di project — cek `printer-settings-form.tsx` kalau ragu).

- [ ] **Step 1: Replace stub with real component**

Path: `app/(app)/setup/ai-usage/summary-card.tsx`

```tsx
import type { UsageSummary } from '@/lib/ai-usage';
import { formatRp } from '@/lib/currency';
import { estimateCostIdr } from '@/lib/pricing';

const compact = new Intl.NumberFormat('id-ID', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function SummaryCard({
  summary,
  monthLabel,
}: {
  summary: UsageSummary;
  monthLabel: string;
}) {
  const idr = estimateCostIdr(summary.input, summary.output);
  return (
    <section className="rounded-lg border border-coal/15 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-coal-soft">
        Bulan ini · {monthLabel}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Scan" value={summary.scan.toLocaleString('id-ID')} />
        <Stat
          label="Sukses / Gagal"
          value={`${summary.success.toLocaleString('id-ID')} / ${summary.fail.toLocaleString('id-ID')}`}
        />
        <Stat label="Token" value={compact.format(summary.total)} />
        <Stat label="Est. biaya" value={`~${formatRp(idr)}`} />
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-coal-soft">{label}</div>
      <div className="mt-0.5 font-display text-lg text-coal">{value}</div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Manual smoke**

Run: `npm run dev`, visit `/setup/ai-usage`.
Expected: summary card muncul dengan "Bulan ini · Juli 2026", 4 stat kotak. Semua nilai `0` karena belum ada data.

Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/setup/ai-usage/summary-card.tsx
git commit -m "feat(ai-usage): summary card for month totals"
```

---

## Task 10: Implement `AiUsageChart` (recharts BarChart)

**Files:**
- Modify: `app/(app)/setup/ai-usage/ai-usage-chart.tsx`

**Context:**
- `recharts` 3.9.0 sudah ter-install.
- Stacked bar: `input_tokens` + `output_tokens`.
- X-axis label format `d MMM` sederhana pakai `Date` locale id-ID.
- Empty state: kalau `rows.length === 0` tampilin placeholder.
- Warna: gunakan tokens existing (`gold`, `flame`, atau custom hex kalau perlu). Cek `components/ui/chart.tsx` untuk pattern chart yang ada — kalau ada helper theming pakai itu.

- [ ] **Step 1: Replace stub with recharts implementation**

Path: `app/(app)/setup/ai-usage/ai-usage-chart.tsx`

```tsx
'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { AiUsageRow } from '@/lib/ai-usage';
import { formatRp } from '@/lib/currency';
import { estimateCostIdr } from '@/lib/pricing';

const compact = new Intl.NumberFormat('id-ID', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function shortDate(ymd: string): string {
  // 'YYYY-MM-DD' → '2 Jul'
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

type ChartRow = {
  date: string;
  label: string;
  input: number;
  output: number;
  scan: number;
  success: number;
  fail: number;
  idr: number;
};

function toChartRows(rows: AiUsageRow[]): ChartRow[] {
  return rows.map((r) => {
    const input = Number(r.input_tokens);
    const output = Number(r.output_tokens);
    return {
      date: r.date,
      label: shortDate(r.date),
      input,
      output,
      scan: r.scan_count,
      success: r.success_count,
      fail: r.fail_count,
      idr: estimateCostIdr(input, output),
    };
  });
}

export function AiUsageChart({ rows }: { rows: AiUsageRow[] }) {
  const data = toChartRows(rows);

  if (data.length === 0) {
    return (
      <section className="rounded-lg border border-coal/15 bg-white p-6 text-center text-sm text-coal-soft">
        Belum ada data. Data akan muncul setelah OCR scan pertama.
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-coal/15 bg-white p-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-coal-soft">
        30 hari terakhir · Token (stacked)
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveEnd" />
            <YAxis tickFormatter={(v) => compact.format(Number(v))} tick={{ fontSize: 11 }} width={48} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="input" stackId="tok" fill="#c99a2e" name="Input" />
            <Bar dataKey="output" stackId="tok" fill="#a13c1e" name="Output" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartRow }> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border border-coal/20 bg-white px-3 py-2 text-xs shadow-md">
      <div className="font-semibold text-coal">{row.label}</div>
      <div className="mt-1 space-y-0.5 text-coal">
        <div>Scan: {row.scan} <span className="text-coal-soft">({row.success} sukses, {row.fail} gagal)</span></div>
        <div>Input: {compact.format(row.input)}</div>
        <div>Output: {compact.format(row.output)}</div>
        <div>Est. biaya: ~{formatRp(row.idr)}</div>
      </div>
    </div>
  );
}
```

**Warna hex**: `#c99a2e` (gold-ish) dan `#a13c1e` (brick-ish) — approximation dari palette pak-pon (cek `app/globals.css @theme` kalau mau exact color token; kalau ada CSS var pakai `var(--color-gold)` inline via style bukan className, karena recharts butuh string). Sesuaikan kalau owner mau.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Manual smoke**

Run: `npm run dev`, visit `/setup/ai-usage`.
Expected (data kosong): "Belum ada data. Data akan muncul setelah OCR scan pertama."

Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/setup/ai-usage/ai-usage-chart.tsx
git commit -m "feat(ai-usage): recharts stacked bar chart for 30-day token usage"
```

---

## Task 11: Implement `AiUsageTable`

**Files:**
- Modify: `app/(app)/setup/ai-usage/ai-usage-table.tsx`

**Context:**
- `rows` sudah descending (terbaru di atas).
- Highlight row yang `date === today`.

- [ ] **Step 1: Replace stub with table**

Path: `app/(app)/setup/ai-usage/ai-usage-table.tsx`

```tsx
'use client';

import type { AiUsageRow } from '@/lib/ai-usage';
import { formatRp } from '@/lib/currency';
import { estimateCostIdr } from '@/lib/pricing';

const compact = new Intl.NumberFormat('id-ID', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function shortDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function AiUsageTable({ rows, today }: { rows: AiUsageRow[]; today: string }) {
  if (rows.length === 0) return null;
  return (
    <section className="rounded-lg border border-coal/15 bg-white">
      <div className="border-b border-coal/10 px-4 py-2 text-xs uppercase tracking-wide text-coal-soft">
        Detail harian
      </div>
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white text-xs uppercase text-coal-soft">
            <tr className="border-b border-coal/10">
              <th className="px-3 py-2 text-left font-medium">Tgl</th>
              <th className="px-3 py-2 text-right font-medium">Scan</th>
              <th className="px-3 py-2 text-right font-medium">Sukses/Gagal</th>
              <th className="px-3 py-2 text-right font-medium">Input</th>
              <th className="px-3 py-2 text-right font-medium">Output</th>
              <th className="px-3 py-2 text-right font-medium">Est. IDR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const input = Number(r.input_tokens);
              const output = Number(r.output_tokens);
              const idr = estimateCostIdr(input, output);
              const isToday = r.date === today;
              return (
                <tr
                  key={r.date}
                  className={`border-b border-coal/5 ${isToday ? 'bg-gold/10' : ''}`}
                >
                  <td className="px-3 py-2 text-coal">
                    {shortDate(r.date)}
                    {isToday && <span className="ml-1 text-[10px] text-coal-soft">(hari ini)</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-coal">{r.scan_count}</td>
                  <td className="px-3 py-2 text-right text-coal-soft">
                    {r.success_count} / {r.fail_count}
                  </td>
                  <td className="px-3 py-2 text-right text-coal">{compact.format(input)}</td>
                  <td className="px-3 py-2 text-right text-coal">{compact.format(output)}</td>
                  <td className="px-3 py-2 text-right text-coal">~{formatRp(idr)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Manual smoke**

Run: `npm run dev`, visit `/setup/ai-usage`.
Expected: tabel tidak muncul karena `rows.length === 0`.

Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/setup/ai-usage/ai-usage-table.tsx
git commit -m "feat(ai-usage): daily detail table with today highlight"
```

---

## Task 12: Add env docs

**Files:**
- Modify: `.env.example`

**Context:** Project punya `.env.example` (dari `git log` recent commits menyebut `NEXT_PUBLIC_IMAGE_MAX_WIDTH` di sana).

- [ ] **Step 1: Append 3 new envs**

Modify `.env.example`, append at end:

```
# Gemini pricing → IDR estimate for /setup/ai-usage.
# Default = Gemini 3.5 Flash rate at design time (2026-07). Update jika harga berubah.
GEMINI_INPUT_RATE_USD_PER_1M=0.30
GEMINI_OUTPUT_RATE_USD_PER_1M=2.50
USD_IDR_RATE=16000
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore(env): document Gemini pricing envs for /setup/ai-usage"
```

---

## Task 13: End-to-end smoke test

**Files:** (no code change)

**Context:** Verify OCR scan → row muncul di `/setup/ai-usage`.

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Login as owner, do 1 scan**

Open `http://localhost:3000/scan`, foto nota (atau upload gambar test), submit.

- [ ] **Step 3: Verify data muncul**

Navigate to `http://localhost:3000/setup/ai-usage`.
Expected:
- Summary card menunjukkan `Scan: 1`, `Sukses/Gagal: 1 / 0` (atau `0/1` kalau gagal), `Token: XXk`, `Est. biaya: ~Rp XX`.
- Chart bar 1 batang untuk hari ini.
- Tabel 1 row highlighted (hari ini).

- [ ] **Step 4: Verify Supabase row**

Di Supabase Studio, buka tabel `ai_usage_daily`. Verify 1 row untuk hari ini dengan angka yang match summary card.

- [ ] **Step 5: Verify negative case — dropdown nav**

Reload page, klik gear icon → dropdown muncul → klik "Setting Printer" → navigate. Klik gear lagi → "AI Usage" → navigate kembali.

- [ ] **Step 6: Stop dev, verify tests still green**

Ctrl+C, then:
Run: `npm run test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 7: Final commit (no code — this is just a checkpoint)**

Kalau semua verified, tidak ada file baru. Skip commit — semua sudah committed di task sebelumnya.

---

## Rollout notes (post-merge)

1. `supabase db push` ke prod (kalau belum di Task 1).
2. Set 3 env di Vercel prod dashboard: `GEMINI_INPUT_RATE_USD_PER_1M=0.30`, `GEMINI_OUTPUT_RATE_USD_PER_1M=2.50`, `USD_IDR_RATE=16000`. Kalau tidak diset, fallback default aktif.
3. Deploy. Data mulai tercatat dari OCR scan pertama setelah deploy.
