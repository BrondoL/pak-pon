# AI Usage Monitor — Design

**Status**: Draft
**Date**: 2026-07-02
**Author**: brondol + Claude
**Related**: [`2026-07-01-ocr-image-schema-optimization-design.md`](./2026-07-01-ocr-image-schema-optimization-design.md), `docs/logging.md`

## 1. Ringkasan

Halaman baru `/setup/ai-usage` untuk owner memantau konsumsi token OCR Gemini per hari, plus estimasi biaya IDR. Data dipersist ke tabel Supabase baru `ai_usage_daily` (1 row per hari WIB), di-populate secara best-effort dari `POST /api/scan` finally block. Navbar gear icon di-refactor jadi dropdown supaya menampung entry "AI Usage" bareng existing "Setting Printer".

**Non-goals**:
- Tidak backfill historical data (log lama di Vercel stdout ditinggal).
- Tidak track model AI lain (Gemini OCR only — YAGNI).
- Tidak per-request drill-down (aggregate harian aja).
- Tidak alerting / notifikasi budget.

## 2. Motivasi

Sekarang token usage OCR di-emit ke stdout via `console.log(JSON.stringify(event))` di `lib/logger.ts:80`. Owner ga punya cara mudah tau berapa habis token / IDR per bulan tanpa scrape Vercel logs. Kebutuhan naik seiring volume scan (~150 tx/hari saat design ditulis, sesuai CLAUDE.md).

## 3. Arsitektur

### Data flow

```
POST /api/scan
   ├─ scanNota() → response.usageMetadata → attempt.{input,output,total}_tokens
   ├─ evt.merge({ ocr_attempts, ocr_total_failure, ... })
   ├─ [respond ke client]
   └─ finally:
        ├─ evt.emit()                       // existing: console.log JSON
        └─ await recordUsageDaily({ ... })  // NEW: UPSERT ai_usage_daily
              └─ best-effort try/catch → console.warn if fail
```

Karena `RequestEvent.fields` private, helper `recordUsageDaily` menerima params eksplisit (bukan `evt` object), jadi caller yang meng-extract dari `ocrMeta`/scope route.

### File tree baru

```
app/(app)/setup/ai-usage/
  page.tsx                       # server component, fetch + render
  ai-usage-chart.tsx             # client, recharts BarChart 30 hari
  ai-usage-table.tsx             # client, tabel harian
  summary-card.tsx               # server component, tampilan month summary
lib/
  ai-usage.ts                    # recordUsageDaily(), aggregateSummary(), type AiUsageRow
  pricing.ts                     # estimateCostIdr() env-based
  date.ts                        # existing — sudah ada businessDate(), currentBusinessDate(),
                                 # businessDatesInMonth(), parseYmd(), parseYm().
                                 # Reuse ini; TIDAK bikin helper baru untuk WIB.
supabase/migrations/
  0028_ai_usage_daily.sql
components/ui/
  dropdown-menu.tsx              # via `npx shadcn@latest add dropdown-menu`
components/
  nav.tsx                        # refactor gear icon → DropdownMenu
```

## 4. Skema DB

Migration `supabase/migrations/0028_ai_usage_daily.sql`:

```sql
-- Table
CREATE TABLE ai_usage_daily (
  date            date PRIMARY KEY,            -- WIB, YYYY-MM-DD
  scan_count      integer NOT NULL DEFAULT 0,  -- sukses + gagal
  success_count   integer NOT NULL DEFAULT 0,
  fail_count      integer NOT NULL DEFAULT 0,
  input_tokens    bigint  NOT NULL DEFAULT 0,
  output_tokens   bigint  NOT NULL DEFAULT 0,
  total_tokens    bigint  NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_usage_daily_date_desc ON ai_usage_daily (date DESC);

-- Auto-touch updated_at (function `set_updated_at` sudah ada di migrasi 0001).
CREATE TRIGGER ai_usage_daily_touch
  BEFORE UPDATE ON ai_usage_daily
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Atomic upsert increment RPC
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

-- RLS: authenticated user (owner/kasir share 1 akun) boleh read.
-- Write cuma via RPC di atas (SECURITY DEFINER → bypass RLS, dipanggil server-side).
ALTER TABLE ai_usage_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_usage_daily_read ON ai_usage_daily
  FOR SELECT USING (auth.role() = 'authenticated');
```

**Rationale**:
- `date` PK — 1 row per hari WIB, auto-dedupe.
- Invariant `scan_count = success_count + fail_count` tidak di-CHECK constraint (redundant, RPC yang tanggung jawab).
- `bigint` untuk token sums — safe untuk pertumbuhan multi-tahun.
- Tidak simpan IDR — dihitung di app pakai env rate saat render (rate bisa berubah, historical row tetap accurate karena token count fixed).
- Fungsi `SECURITY DEFINER` supaya call dari server-side client (yang authenticated tapi bukan service_role) tetep bisa write walau RLS ketat.

## 5. Recording logic

### `lib/pricing.ts` (baru)

```ts
const INPUT_USD_PER_1M = Number(process.env.GEMINI_INPUT_RATE_USD_PER_1M ?? '0.30');
const OUTPUT_USD_PER_1M = Number(process.env.GEMINI_OUTPUT_RATE_USD_PER_1M ?? '2.50');
const USD_IDR = Number(process.env.USD_IDR_RATE ?? '16000');

export function estimateCostIdr(inputTokens: number, outputTokens: number): number {
  const usd =
    (inputTokens * INPUT_USD_PER_1M + outputTokens * OUTPUT_USD_PER_1M) / 1_000_000;
  return Math.round(usd * USD_IDR);
}

export function pricingSnapshot() {
  return { INPUT_USD_PER_1M, OUTPUT_USD_PER_1M, USD_IDR };
}
```

- Default fallback mirror harga Gemini 3.5 Flash saat design ini ditulis (aman kalau env belum di-set).
- Env baru ditambah di `.env.example`:
  ```
  GEMINI_INPUT_RATE_USD_PER_1M=0.30
  GEMINI_OUTPUT_RATE_USD_PER_1M=2.50
  USD_IDR_RATE=16000
  ```

### `lib/ai-usage.ts` (baru)

```ts
import { getSupabaseServer } from './supabase/server';
import { businessDate } from './date';

type Attempt = { input_tokens?: number; output_tokens?: number; total_tokens?: number };

export type RecordArgs = {
  attempts: Attempt[];
  failed: boolean;      // dari ocrMeta.final_model === null
  requestStartedAt?: Date;
};

export async function recordUsageDaily(args: RecordArgs): Promise<void> {
  try {
    if (!args.attempts?.length) return;

    const input = args.attempts.reduce((s, a) => s + (a.input_tokens ?? 0), 0);
    const output = args.attempts.reduce((s, a) => s + (a.output_tokens ?? 0), 0);
    const total = args.attempts.reduce((s, a) => s + (a.total_tokens ?? 0), 0);
    // Kalau ga ada token sama sekali (misal error sebelum call Gemini), skip
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

// Untuk page.tsx summary card
export function aggregateSummary(rows: AiUsageRow[]) {
  const scan = rows.reduce((s, r) => s + r.scan_count, 0);
  const success = rows.reduce((s, r) => s + r.success_count, 0);
  const fail = rows.reduce((s, r) => s + r.fail_count, 0);
  const input = rows.reduce((s, r) => s + Number(r.input_tokens), 0);
  const output = rows.reduce((s, r) => s + Number(r.output_tokens), 0);
  const total = rows.reduce((s, r) => s + Number(r.total_tokens), 0);
  return { scan, success, fail, input, output, total };
}
```

**Catatan**:
- `bigint` dari `supabase-js` bisa datang sebagai `string` atau `number` tergantung serialization. `aggregateSummary` cast via `Number()` defensif (aman sampai 2^53 = 9 quadrillion token — pak-pon ga akan reach itu).
- Skip UPSERT kalau input & output 0 (misal error network sebelum sempet call Gemini) — biar tidak inflate `scan_count` untuk request yang benar-benar tidak menghasilkan billable event.

Tipe `AiUsageRow` diekspor dari `lib/ai-usage.ts`, matches SQL columns:
```ts
export type AiUsageRow = {
  date: string;                    // 'YYYY-MM-DD'
  scan_count: number;
  success_count: number;
  fail_count: number;
  input_tokens: number | string;   // bigint
  output_tokens: number | string;
  total_tokens: number | string;
  created_at: string;
  updated_at: string;
};
```

### Hook di `app/api/scan/route.ts`

Existing finally block:
```ts
} finally {
  evt.emit();
  // NEW:
  await recordUsageDaily({
    attempts: ocrMeta.attempts,
    failed: ocrMeta.final_model === null,
    requestStartedAt,  // capture new Date() di TOP handler, before try — konsisten dengan pola existing
  });
}
```

**IMPLEMENTATION-PHASE CHECK**: `requestStartedAt` mungkin belum ada sebagai variable di scope. Kalau begitu, capture `const requestStartedAt = new Date();` di awal handler (before `try`), lalu pass ke `recordUsageDaily`. Alternatif: fallback ke `new Date()` di helper (sudah dilakukan lewat default `?? new Date()`), tapi kurang akurat kalau request panjang cross midnight WIB.

`await` sengaja (bukan fire-and-forget) supaya Vercel Function tidak keburu selesai sebelum RPC beres. Karena di dalam try/catch, error tetap ditelan — tidak affect response yang sudah dikirim.

## 6. Halaman & UI

### `app/(app)/setup/ai-usage/page.tsx`

```ts
export const dynamic = 'force-dynamic';

export default async function AiUsagePage() {
  const supabase = await getSupabaseServer();
  const today = todayWIB();  // YYYY-MM-DD
  const monthStart = firstDayOfMonthWIB(today);
  const thirtyDaysAgo = subtractDaysWIB(today, 29);

  const { data: rowsRaw } = await supabase
    .from('ai_usage_daily')
    .select('*')
    .gte('date', thirtyDaysAgo)
    .order('date', { ascending: false });

  const rows = rowsRaw ?? [];
  const monthRows = rows.filter(r => r.date >= monthStart);
  const monthSummary = aggregateSummary(monthRows);
  const chartRows = [...rows].reverse();  // ascending untuk chart

  return (
    <div className="mx-auto max-w-4xl p-4 space-y-6">
      <div>
        <h1 className="font-display text-2xl text-coal">AI Usage</h1>
        <p className="mt-1 text-sm text-coal-soft">
          Konsumsi token OCR Gemini per hari (WIB).
        </p>
      </div>
      <SummaryCard {...monthSummary} monthLabel={formatMonthWIB(today)} />
      <AiUsageChart rows={chartRows} />
      <AiUsageTable rows={rows} />
    </div>
  );
}
```

### Summary card

```
┌───────────────────────────────────────────────────────┐
│ Bulan ini · Juli 2026                                 │
├───────────────────────────────────────────────────────┤
│ Scan       Sukses     Token         Est. biaya        │
│ 890        876 / 14   1,6 M         ~Rp 12.400        │
└───────────────────────────────────────────────────────┘
```
- `formatRp()` dari `lib/currency.ts`.
- `formatCompact()` (baru, atau inline) → `Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 })`.

### Chart (`ai-usage-chart.tsx`, client)

- Recharts `<BarChart>` stacked: `input_tokens` (biru) + `output_tokens` (kuning-orange).
- X axis: `date-fns` format `d MMM` dengan `id` locale.
- Tooltip custom: scan_count, sukses/gagal, in / out (formatCompact), total, estimasi IDR.
- Height ~200-240px, responsive width.
- Kalau `rows.length === 0`: placeholder "Belum ada data. Data mulai tercatat dari OCR scan pertama setelah rilis fitur ini."

### Tabel (`ai-usage-table.tsx`, client)

Kolom: **Tgl · Scan · Sukses/Gagal · Input · Output · Total · Est. IDR**

- Max 30 row (dari query 30 hari terakhir). Overflow scroll vertikal, header sticky.
- Baris hari ini di-highlight (bg-*/ label kecil "hari ini").
- IDR dihitung per row pakai `estimateCostIdr(row.input_tokens, row.output_tokens)`.

## 7. Navbar (`components/nav.tsx`)

Gear icon existing di line 52-62 di-refactor jadi shadcn DropdownMenu:

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <button
      aria-label="Setup"
      className="ml-0.5 inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-ash focus:outline-none focus:ring-2 focus:ring-flame"
    >
      <GearIcon />
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
```

**Pre-req**: install shadcn dropdown-menu (`components/ui/dropdown-menu.tsx` belum ada). Perintah:
```
npx shadcn@latest add dropdown-menu
```

**Rationale**: 1 icon tetap, scalable untuk nambah entry setting lain kedepannya tanpa menambah icon ke navbar.

## 8. Failure modes & handling

| Skenario | Behavior |
|---|---|
| Gemini call error network | attempts array kosong / tanpa token → `recordUsageDaily` skip (input=output=0 guard). |
| Gemini charge input tapi output 0 (empty result) | Tetap direcord sebagai `fail_count=1`, `input_tokens>0`. Owner melihat "burn tapi gagal". |
| Supabase RPC error | `console.warn`, response tetap dikirim ke client. Data hari itu miss 1 entry — akseptabel. |
| Env rate belum di-set | Pakai fallback default hardcoded di `pricing.ts`. |
| Table kosong (fitur baru rilis) | Chart & table tampilin placeholder "Belum ada data." |
| Cron print-sweep / cron lain jalan bareng | Ga relevan — RPC atomic increment, no race. |

## 9. Testing

**Unit tests** (colocated dengan source, contoh `lib/pricing.test.ts` — pattern existing di project):
- `lib/pricing.test.ts` — `estimateCostIdr` dengan input/output tokens & rate default → assert rounding & math.
- `lib/ai-usage.test.ts` — mock supabase, verify `recordUsageDaily`:
  - Skip kalau attempts kosong.
  - Skip kalau input=output=0.
  - Failed=true → `p_fail=1, p_success=0`.
  - Sum multiple attempts benar.
  - `aggregateSummary` sum bigint (string) rows correctly.

**Manual smoke** (dev):
- Jalankan `npm run dev`, upload 3-5 nota (mix sukses & gagal), buka `/setup/ai-usage`, verify:
  - Row muncul tanggal hari ini WIB.
  - Chart tampil bar.
  - Summary card menunjukkan angka konsisten.

## 10. Rollout

1. Migration `0028_ai_usage_daily.sql` (up-only, no down needed — table kosong).
2. Deploy code baru — hari deploy = hari data pertama tercatat.
3. Tambah 3 env di Vercel prod: `GEMINI_INPUT_RATE_USD_PER_1M=0.30`, `GEMINI_OUTPUT_RATE_USD_PER_1M=2.50`, `USD_IDR_RATE=16000`. Kalau tidak di-set, fallback default sama.
4. Owner test dari UI: buka gear → AI Usage → lihat placeholder "Belum ada data".
5. Lakukan 1-2 scan dari kasir → refresh page → verify row muncul.

**Rollback**: revert code + `DROP TABLE ai_usage_daily; DROP FUNCTION increment_ai_usage_daily;`. Zero downstream impact (fitur observability only).

## 11. Open questions / future

- Kalau nanti tambah model AI lain (Claude untuk analisa, dll), refactor jadi `(date, model)` composite key. Tapi YAGNI sekarang.
- Kalau data > 1 tahun mau di-trim, tambah cron cleanup — 1 row/hari = 365/tahun, ga urgent.
- Alert budget (misal "bulan ini sudah 50k IDR") — future, out of scope.
