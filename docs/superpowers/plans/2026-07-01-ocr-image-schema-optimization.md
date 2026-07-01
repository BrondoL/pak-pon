# OCR Image + Schema Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turunkan input tokens per scan `/api/scan` dari ~1691 → **~1000-1200** dengan (A2) memindahkan menu enum dari prompt text ke Gemini `responseSchema`, dan (A1) menurunkan `maxWidthOrHeight` compress image dari 1600 → configurable via env (target 800px).

**Architecture:** Dua perubahan independen, sequenced ship. **A2 dulu** (pure API refactor, lower risk) → observe 24 jam → **A1** (feature flag rollout, gradual). Consumer code (`/api/scan/route.ts`, Zod transform, `EMPTY_RESULT`) tak berubah — semua abstraksi ada di `lib/gemini.ts` + `lib/prompts.ts` + `lib/compress.ts`.

**Tech Stack:** `@google/genai` v6 (responseSchema OpenAPI 3.0 subset), Zod, `browser-image-compression`, Next.js 16 App Router, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-01-ocr-image-schema-optimization-design.md`

---

## File Structure

**Modified:**
- `lib/prompts.ts` — hapus `buildMenuRefText`, tambah `buildScanResponseSchema(menus)`, trim `OCR_SYSTEM_PROMPT` (menu instruksi jadi redundant karena schema constraint)
- `lib/prompts.test.ts` — hapus tests untuk `buildMenuRefText`, tambah tests untuk `buildScanResponseSchema`
- `lib/gemini.ts` — pakai `responseSchema` config, hapus `menuRefText` concatenation
- `lib/compress.ts` — read `NEXT_PUBLIC_IMAGE_MAX_WIDTH` env var (default 1600)
- `.env.example` — dokumentasi env var baru

**Created:**
- `scripts/verify-response-schema.mjs` — one-shot smoke script buat Task 1 (blocking verification). Bisa dihapus setelah verify.

**No DB changes. No API contract changes. No consumer code changes.**

---

## Baseline (2026-07-01)

Dari log production sample terakhir (`request_id: 189778aa-4f6d-...`):
- Input: 1691 tok (image ~1100, prompt+menu ~430, misc ~160)
- Output: 188 tok
- Total: 1879

---

## Task 1: Verify `responseSchema` token accounting (BLOCKING)

**Files:**
- Create: `scripts/verify-response-schema.mjs`

**Goal:** Confirm whether menu enum values di `responseSchema` di-count sebagai input tokens sebelum spend engineering untuk A2.

- [ ] **Step 1: Tulis smoke script**

Create `scripts/verify-response-schema.mjs`:

```js
// One-shot smoke test — jalanin dengan `node scripts/verify-response-schema.mjs`.
// Butuh GEMINI_API_KEY di .env.local.
import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'node:fs';
import { config } from 'dotenv';
config({ path: '.env.local' });

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_FAST_MODEL ?? 'gemini-3.5-flash';

// 31 dummy menu names mirroring produksi count.
const MENUS = Array.from({ length: 31 }, (_, i) => `Menu ${i + 1}`);

// Dummy 1x1 PNG (base64) — image tokens minimal supaya diff kelihatan di prompt/schema.
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const BASE_PROMPT = 'OCR nota. Return JSON: {"i":[{"m":"<menu>","q":1}],"t":0}';

async function run(label, config) {
  const t0 = Date.now();
  const res = await client.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [
      { text: BASE_PROMPT },
      { inlineData: { mimeType: 'image/png', data: TINY_PNG } },
    ]}],
    config,
  });
  const usage = res.usageMetadata;
  console.log(`[${label}] input=${usage?.promptTokenCount} output=${usage?.candidatesTokenCount} duration=${Date.now() - t0}ms`);
  return usage?.promptTokenCount ?? 0;
}

// Test A: baseline (no schema)
const inA = await run('NO SCHEMA', {
  responseMimeType: 'application/json',
  thinkingConfig: { thinkingBudget: 0 },
});

// Test B: with responseSchema having 31-menu enum
const schema = {
  type: 'object',
  properties: {
    i: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          m: { type: 'string', enum: MENUS },
          q: { type: 'integer' },
        },
        required: ['m', 'q'],
      },
    },
    t: { type: 'integer' },
  },
  required: ['i', 't'],
};

const inB = await run('WITH SCHEMA', {
  responseMimeType: 'application/json',
  responseSchema: schema,
  thinkingConfig: { thinkingBudget: 0 },
});

// Test C: menu list dalam prompt text (baseline our current approach)
const inC = await run('MENU IN PROMPT', {
  responseMimeType: 'application/json',
  thinkingConfig: { thinkingBudget: 0 },
}, `${BASE_PROMPT}\n\nMenu master:\n${MENUS.map((m) => `- ${m}`).join('\n')}`);

console.log('---');
console.log(`Delta A→B (add schema): ${inB - inA} tok`);
console.log(`Delta A→C (add menu in prompt): ${inC - inA} tok`);
console.log(`Delta B→C (schema vs prompt): ${inC - inB} tok`);
console.log('---');
console.log(inB - inA < 30
  ? '✓ SCHEMA does NOT count enum as input — A2 viable, expect ~180 tok saving'
  : `✗ SCHEMA counts enum as ~${inB - inA} tok — A2 saving marginal, consider skip`);
```

- [ ] **Step 2: Install `dotenv` kalau belum**

Run: `npm ls dotenv`

Kalau tidak ada, jalankan: `npm install --no-save dotenv` (dev-only, script tidak di-ship).

- [ ] **Step 3: Jalankan smoke script**

Run: `node scripts/verify-response-schema.mjs`

Expected output shape:
```
[NO SCHEMA] input=X output=Y duration=Zms
[WITH SCHEMA] input=X+? output=Y duration=Zms
[MENU IN PROMPT] input=X+180ish output=Y duration=Zms
---
Delta A→B (add schema): N tok
Delta A→C (add menu in prompt): ~180 tok
Delta B→C (schema vs prompt): ~180 tok (positif = schema hemat)
---
✓ SCHEMA does NOT count enum as input — A2 viable, expect ~180 tok saving
```

- [ ] **Step 4: Decision gate**

Baca output baris terakhir.

- **Kalau ✓ (schema hemat, delta A→B <30 tok)** → **lanjut ke Task 2**.
- **Kalau ✗ (schema counts enum sebagai ~180 tok)** → **SKIP Task 2-6, langsung Task 7 (A1 image compression)**. Update spec file dengan catatan "A2 tidak feasible per verify 2026-07-XX — Gemini count enum in schema as input tokens". Commit spec update.

- [ ] **Step 5: Cleanup + commit (kalau proceed)**

```bash
git add scripts/verify-response-schema.mjs
git commit -m "chore(ocr): smoke script verify responseSchema token behavior"
```

Kalau ✗ path taken: hapus script + skip commit.

---

## Task 2: Add `buildScanResponseSchema(menus)` + tests

**Files:**
- Modify: `lib/prompts.ts`
- Modify: `lib/prompts.test.ts`

**Prerequisite:** Task 1 = ✓.

- [ ] **Step 1: Write failing tests**

Edit `lib/prompts.test.ts` — di akhir file, tambah describe block:

```ts
import { buildScanResponseSchema } from './prompts';

describe('buildScanResponseSchema', () => {
  it('returns OpenAPI 3.0 schema with menu enum constraint', () => {
    const schema = buildScanResponseSchema(sampleMenus);
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(expect.arrayContaining(['i', 't']));
    const itemSchema = (schema.properties as any).i.items;
    expect((itemSchema.properties.m as any).enum).toEqual(['Pecel Lele', 'Es Teh']);
    expect(itemSchema.required).toEqual(expect.arrayContaining(['m', 'q']));
  });

  it('marks n / c / a / cn / tn as optional (not in required)', () => {
    const schema = buildScanResponseSchema(sampleMenus);
    const itemSchema = (schema.properties as any).i.items;
    expect(itemSchema.required).not.toContain('n');
    expect(itemSchema.required).not.toContain('c');
    expect(itemSchema.required).not.toContain('a');
    expect(schema.required).not.toContain('cn');
    expect(schema.required).not.toContain('tn');
  });

  it('constrains alternatives.m to menu enum too', () => {
    const schema = buildScanResponseSchema(sampleMenus);
    const itemSchema = (schema.properties as any).i.items;
    const altSchema = itemSchema.properties.a.items;
    expect((altSchema.properties.m as any).enum).toEqual(['Pecel Lele', 'Es Teh']);
  });

  it('handles empty menu list (no enum constraint)', () => {
    const schema = buildScanResponseSchema([]);
    const itemSchema = (schema.properties as any).i.items;
    expect((itemSchema.properties.m as any).enum).toBeUndefined();
    expect(itemSchema.properties.m.type).toBe('string');
  });
});
```

- [ ] **Step 2: Run test — expect fail (function not yet exported)**

Run: `./node_modules/.bin/vitest run lib/prompts.test.ts`
Expected: fail dengan "buildScanResponseSchema is not exported".

- [ ] **Step 3: Implement `buildScanResponseSchema`**

Edit `lib/prompts.ts` — di akhir file, tambah:

```ts
/**
 * Build Gemini responseSchema (OpenAPI 3.0 subset) yang constrain output ke:
 * - `m` (menu_name) hanya salah satu dari master list — no hallucination possible
 * - Field required minimum: item wajib `m`+`q`, root wajib `i`+`t`
 * - `n` / `c` / `a` / `cn` / `tn` optional supaya Gemini bisa omit null (token saver)
 */
export function buildScanResponseSchema(menus: MenuRef[]) {
  const menuNames = menus.map((m) => m.name);
  const menuNameProp: Record<string, unknown> =
    menuNames.length > 0
      ? { type: 'string', enum: menuNames }
      : { type: 'string' };

  const altSchema = {
    type: 'object',
    properties: {
      m: menuNameProp,
    },
    required: ['m'],
  };

  return {
    type: 'object',
    properties: {
      i: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            m: menuNameProp,
            q: { type: 'integer' },
            n: { type: 'string' },
            c: { type: 'integer' },
            a: {
              type: 'array',
              items: altSchema,
              maxItems: 2,
            },
          },
          required: ['m', 'q'],
        },
      },
      t: { type: 'integer' },
      cn: { type: 'string' },
      tn: { type: 'string' },
    },
    required: ['i', 't'],
  };
}
```

- [ ] **Step 4: Run tests**

Run: `./node_modules/.bin/vitest run lib/prompts.test.ts`
Expected: all pass (23 existing + 4 new = 27).

- [ ] **Step 5: Commit**

```bash
git add lib/prompts.ts lib/prompts.test.ts
git commit -m "feat(ocr): add buildScanResponseSchema for Gemini native structured output"
```

---

## Task 3: Update `lib/gemini.ts` — pakai `responseSchema`

**Files:**
- Modify: `lib/gemini.ts`

- [ ] **Step 1: Update import**

Edit `lib/gemini.ts` line 2, ganti:

```ts
import { buildScanSchema, buildMenuRefText, OCR_SYSTEM_PROMPT, type MenuRef, type ScanResult } from './prompts';
```

jadi:

```ts
import { buildScanSchema, buildScanResponseSchema, OCR_SYSTEM_PROMPT, type MenuRef, type ScanResult } from './prompts';
```

(Hapus `buildMenuRefText`, tambah `buildScanResponseSchema`.)

- [ ] **Step 2: Ganti body `scanNota()`**

Cari block yang lakukan API call (~line 60-90):

```ts
export async function scanNota(
  base64Image: string,
  mimeType: string,
  menus: MenuRef[]
): Promise<ScanNotaResult> {
  const schema = buildScanSchema(menus);
  const menuRefText = buildMenuRefText(menus);
  const attempts: ScanAttempt[] = [];

  const t0 = Date.now();
  const attempt: ScanAttempt = {
    model: MODEL,
    duration_ms: 0,
    outcome: 'success',
  };

  let response;
  try {
    response = await client.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: OCR_SYSTEM_PROMPT + '\n\n' + menuRefText },
            { inlineData: { mimeType, data: base64Image } },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
  } catch (err) {
    // ...
```

Replace jadi:

```ts
export async function scanNota(
  base64Image: string,
  mimeType: string,
  menus: MenuRef[]
): Promise<ScanNotaResult> {
  const schema = buildScanSchema(menus);
  const responseSchema = buildScanResponseSchema(menus);
  const attempts: ScanAttempt[] = [];

  const t0 = Date.now();
  const attempt: ScanAttempt = {
    model: MODEL,
    duration_ms: 0,
    outcome: 'success',
  };

  let response;
  try {
    response = await client.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: OCR_SYSTEM_PROMPT },
            { inlineData: { mimeType, data: base64Image } },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        responseSchema: responseSchema as any,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
  } catch (err) {
    // ...
```

Perubahan konkret:
- Line: `const menuRefText = buildMenuRefText(menus);` → `const responseSchema = buildScanResponseSchema(menus);`
- Line: `{ text: OCR_SYSTEM_PROMPT + '\n\n' + menuRefText }` → `{ text: OCR_SYSTEM_PROMPT }`
- Config: tambah `responseSchema: responseSchema as any,` (cast karena `SchemaUnion` di SDK longgar tapi kita bikin JSON schema literal)

- [ ] **Step 3: Verify build**

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.json 2>&1 | head -10`
Expected: clean (no error). Kalau ada error `buildMenuRefText` unused, itu di prompts.ts — akan di-clean Task 4.

- [ ] **Step 4: Commit**

```bash
git add lib/gemini.ts
git commit -m "feat(ocr): use Gemini responseSchema for native enum constraint"
```

---

## Task 4: Trim `lib/prompts.ts` — hapus `buildMenuRefText` + trim OCR_SYSTEM_PROMPT

**Files:**
- Modify: `lib/prompts.ts`
- Modify: `lib/prompts.test.ts`

**Kenapa**: setelah A2, menu list tidak lagi di-kirim via prompt. `buildMenuRefText` orphan → hapus. Prompt instruksi soal "menu HARUS persis dari master" jadi redundant (schema enforces).

- [ ] **Step 1: Hapus `buildMenuRefText` dari `lib/prompts.ts`**

Cari block:

```ts
export function buildMenuRefText(menus: MenuRef[]): string {
  if (menus.length === 0) return 'Daftar menu master kosong.';
  const lines = menus.map((m) => `- ${m.name}`);
  return `Daftar menu master (gunakan nama PERSIS seperti tertulis di sini):\n${lines.join('\n')}`;
}
```

Hapus. Nothing else references it after Task 3.

- [ ] **Step 2: Trim `OCR_SYSTEM_PROMPT`**

Edit `OCR_SYSTEM_PROMPT` — ganti section "Aturan" dan "Output JSON" jadi:

```ts
export const OCR_SYSTEM_PROMPT = `OCR nota Pak Pon. Qty handwritten di kolom "Banyak nya"; cek SEMUA baris termasuk pensil tipis.

PRIORITAS: jangan miss item. Tebak qty/menu yang ragu daripada skip.

LOOK-ALIKE (pasangan yang sering tertukar — kalau kata penentu tidak terbaca jelas, confidence WAJIB <=70 + sertakan alternatives):
- "X goreng" vs "X bakar" (Ayam, Ayam Kampung, Bebek, Burung Dara, Nila)
- "Es X" vs "X panas" vs "X tawar" (Teh)

Output JSON dengan key pendek (schema define required + enum menu):
- i[]: items. Tiap item minimum {"m","q"}. Skip item kalau qty kosong.
- m: menu — schema batasi ke daftar master, tidak perlu paraphrase.
- q: qty positif integer.
- n: notes anotasi handwritten (cth "PAHA"). Kalau ga jelas, tulis mentahnya. Skip kalau kosong.
- c: confidence 0-100. Isi kalau ragu. Skip kalau yakin >=95%.
- a: alternatives max 2 (schema enforce enum). Sertakan untuk look-alike pairs.
- t: total. HANYA angka yang ditulis kasir di bagian bawah nota (label "Total"/"Jumlah"). Kalau kasir TIDAK menulis total, t:0. JANGAN hitung sendiri dari items. Convert ke rupiah penuh (SATUAN RIBUAN) — "92"=92000, "92.000"=92000.
- cn, tn: dari kolom "Nama" & "No. Meja". Skip kalau kosong.`;
```

Char count harus tetap < 1800 (guardrail test).

- [ ] **Step 3: Update tests di `lib/prompts.test.ts`**

Hapus `describe('buildMenuRefText', ...)` block (line ~36-54 dari file current). Fungsi tidak ada lagi.

Hapus juga import `buildMenuRefText` dari line 2:

```ts
import { buildScanSchema, buildScanResponseSchema, OCR_SYSTEM_PROMPT, type MenuRef } from './prompts';
```

- [ ] **Step 4: Run tests**

Run: `./node_modules/.bin/vitest run lib/prompts.test.ts`
Expected: all pass (2 test yang dihapus = 27-2 = 25 tests). Guardrail `stays under ~1800 char` should still pass.

- [ ] **Step 5: Full test suite**

Run: `./node_modules/.bin/vitest run`
Expected: 154-2+4 = 156 tests pass (2 buildMenuRefText tests hapus, 4 new buildScanResponseSchema tests).

- [ ] **Step 6: Lint check**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/prompts.ts lib/prompts.test.ts
git commit -m "refactor(ocr): drop buildMenuRefText + trim prompt (menu now in responseSchema)"
```

---

## Task 5: Local dev smoke test + push A2

**Files:** (none — verification only)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: clean production build.

- [ ] **Step 2: Local dev smoke test**

```bash
npm run dev
```

Buka `http://localhost:3000`, login, ke `/scan`, upload foto nota (bisa pakai dummy nota atau yang di produksi).

Cek terminal log wide-event untuk request `POST /api/scan`:
- `ocr_attempts[0].input_tokens` — target: **~1150** (dari 1691 = -32%)
- `ocr_attempts[0].outcome` — target: `success`
- `items_resolved` — target: sama dengan jumlah items di nota
- `handwritten_total` — target: correct (0 kalau ga ada, atau ribuan expanded)
- `ocr_conf_min` — target: stabil (60-100)

Kalau `input_tokens` tidak drop (masih ~1691) → responseSchema tidak apply → revert Task 3 + investigate.

Kalau schema mismatch error → cek raw_text_preview, bisa jadi format enum tidak strict. Investigate + fix.

- [ ] **Step 3: Push ke master**

```bash
git push origin master
```

Vercel auto-deploy. Wait ~2 menit sampai deployment ready.

- [ ] **Step 4: Verify production smoke test**

Buka production URL, `/scan`, upload nota. Cek Vercel logs:
- `input_tokens` drop confirmed
- No new error rate spike

---

## Task 6: Observation gate — 24 jam A2

**Files:** (none — data collection)

- [ ] **Step 1: Wait ~24 jam / 20+ real scans dari kasir**

Owner biarin sistem jalan normal.

- [ ] **Step 2: Sample log analysis**

Buka Vercel logs, filter `POST /api/scan`. Ambil 10-15 sample. Rekam:
- `input_tokens` avg — target: **1100-1300** (baseline 1691)
- `items_resolved` distribution — target: sama seperti baseline (5-8 items typical)
- `ocr_conf_min` distribution — target: no spike ke <60
- `mismatch` rate — target: <15% (banner false-positive OK sesekali)
- Error rate — target: 0 baru (regression)

- [ ] **Step 3: Decision gate**

- **Kalau semua metrik hijau** → lanjut Task 7 (A1 image compression).
- **Kalau input_tokens tidak drop** → `responseSchema` mungkin tidak apply. Investigate `attempt.raw_text_preview` — kalau format berubah, revert Task 3-4. Tetap bisa lanjut A1 kalau mau.
- **Kalau accuracy regression (items miss / low-conf spike)** → prompt trim di Task 4 terlalu agresif. Revert prompt trim tapi keep responseSchema. Iterate prompt.

---

## Task 7: Update `lib/compress.ts` — read `NEXT_PUBLIC_IMAGE_MAX_WIDTH`

**Files:**
- Modify: `lib/compress.ts`

- [ ] **Step 1: Add env var parsing**

Edit `lib/compress.ts` — replace fungsi `compressNotaImage()`:

```ts
const DEFAULT_MAX_WIDTH = 1600;

function readMaxWidth(): number {
  const raw = process.env.NEXT_PUBLIC_IMAGE_MAX_WIDTH;
  if (!raw) return DEFAULT_MAX_WIDTH;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 256 || n > 4096) return DEFAULT_MAX_WIDTH;
  return n;
}

/**
 * Compress foto nota di browser sebelum upload.
 * Default 1600px, override via NEXT_PUBLIC_IMAGE_MAX_WIDTH env var (256-4096).
 * Nilai lebih rendah = image tokens lebih sedikit di Gemini tapi risk accuracy drop
 * untuk handwritten qty (pensil tipis).
 */
export async function compressNotaImage(file: File): Promise<File> {
  return imageCompression(file, {
    maxSizeMB: 0.5,
    maxWidthOrHeight: readMaxWidth(),
    useWebWorker: true,
    fileType: 'image/jpeg',
    initialQuality: 0.8,
  });
}
```

Note: `NEXT_PUBLIC_` prefix wajib supaya env var reachable di browser bundle (Next.js convention). Nilai di-read per-invocation supaya test bisa mock via `process.env`; di production (browser), Next.js inline value at build time — perubahan env var perlu **redeploy** untuk apply.

Guard `n < 256 || n > 4096`: sanity range. <256px = quality tidak bisa dipulihkan; >4096 = boros dan Gemini scale down juga.

- [ ] **Step 2: Add tests**

Create `lib/compress.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('compressNotaImage max width env var', () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_IMAGE_MAX_WIDTH;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_IMAGE_MAX_WIDTH;
    else process.env.NEXT_PUBLIC_IMAGE_MAX_WIDTH = ORIGINAL;
  });

  it('defaults to 1600 when env var missing', async () => {
    delete process.env.NEXT_PUBLIC_IMAGE_MAX_WIDTH;
    // Import lazily supaya env change dibaca fresh
    const mod = await import('./compress');
    // @ts-expect-error — kita test private helper via re-import
    expect(mod.__readMaxWidthForTest?.() ?? 1600).toBe(1600);
  });

  it('parses valid integer within range', async () => {
    process.env.NEXT_PUBLIC_IMAGE_MAX_WIDTH = '800';
    // @ts-expect-error
    const val = (await import('./compress')).__readMaxWidthForTest?.() ?? Number(process.env.NEXT_PUBLIC_IMAGE_MAX_WIDTH);
    expect(val).toBe(800);
  });

  it('falls back to default when value out of range', async () => {
    process.env.NEXT_PUBLIC_IMAGE_MAX_WIDTH = '99';
    // @ts-expect-error
    const val = (await import('./compress')).__readMaxWidthForTest?.() ?? 1600;
    expect(val).toBe(1600);
  });

  it('falls back to default when value non-numeric', async () => {
    process.env.NEXT_PUBLIC_IMAGE_MAX_WIDTH = 'abc';
    // @ts-expect-error
    const val = (await import('./compress')).__readMaxWidthForTest?.() ?? 1600;
    expect(val).toBe(1600);
  });
});
```

Untuk supaya tests bisa panggil `readMaxWidth`, export it under test-only symbol di `lib/compress.ts` di akhir file:

```ts
// Exported for tests only — do not use in production code.
export const __readMaxWidthForTest = readMaxWidth;
```

- [ ] **Step 3: Run tests**

Run: `./node_modules/.bin/vitest run lib/compress.test.ts`
Expected: all 4 pass.

- [ ] **Step 4: Commit**

```bash
git add lib/compress.ts lib/compress.test.ts
git commit -m "feat(compress): NEXT_PUBLIC_IMAGE_MAX_WIDTH env var (default 1600)"
```

---

## Task 8: Update `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add docs**

Edit `.env.example` — cari section Gemini, tambah di bawahnya:

```
# Image compression max dimension (client-side, browser bundle).
# Default 1600. Turun ke 1024 / 800 untuk cost saving Gemini image tokens.
# Range: 256-4096. Di bawah 800 ada risk handwritten qty ga terbaca.
# NEXT_PUBLIC_IMAGE_MAX_WIDTH=1600
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs(env): document NEXT_PUBLIC_IMAGE_MAX_WIDTH"
```

---

## Task 9: Full regression + push A1

**Files:** (none — verification only)

- [ ] **Step 1: Full test**

Run: `./node_modules/.bin/vitest run`
Expected: 156+4 = 160 tests pass.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Push**

```bash
git push origin master
```

Auto-deploy via Vercel. Default env behavior = 1600 = no visible change. Ship safe.

---

## Task 10: Gradual Vercel env rollout

**Files:** (none — Vercel env management)

- [ ] **Step 1: Set env `NEXT_PUBLIC_IMAGE_MAX_WIDTH=1024` di Vercel**

Vercel dashboard → project pak-pon → Settings → Environment Variables:
- Add: `NEXT_PUBLIC_IMAGE_MAX_WIDTH` = `1024` for Production
- Trigger redeploy (env perubahan tidak auto-redeploy — either push commit atau redeploy manual dari dashboard)

Alternative via CLI (kalau vercel installed): `vercel env add NEXT_PUBLIC_IMAGE_MAX_WIDTH production` + redeploy.

- [ ] **Step 2: Observe 24 jam / 20 scans**

Cek Vercel logs sample:
- `input_tokens` — expected: sama or sedikit turun (1024px mungkin masih 2×2 tile karena aspek ratio nota kurus)
- `items_resolved` avg — target: stable
- `ocr_conf_min` — target: no spike ke <60
- Kasir feedback: ada nota yang miss item? Kalau iya, tandai.

- [ ] **Step 3: Kalau clean, turunkan ke 800**

Vercel env: `NEXT_PUBLIC_IMAGE_MAX_WIDTH=800` → redeploy.

Observe 24 jam. Expected drop tok signifikan (~500 tok → total input ~1150).

- [ ] **Step 4: Final decision**

- **Kalau 800 masih akurat** → coba 512 kalau mau agresif.
- **Kalau 800 mulai miss item** → naikkan ke 1024, plan Phase 2 (template crop) kalau mau lebih hemat.
- **Kalau 800 acceptable** → stop di sini, final config.

- [ ] **Step 5: Update spec dengan final result**

Edit `docs/superpowers/specs/2026-07-01-ocr-image-schema-optimization-design.md` — di akhir file tambah section:

```markdown
## Rollout result (updated YYYY-MM-DD)

Final config: `NEXT_PUBLIC_IMAGE_MAX_WIDTH=<final-value>`.

Baseline: input 1691 → final input <XXXX>.
Monthly bill: 600k IDR → <YYY>k IDR.

Notes: <observations, edge cases, kasir feedback>.
```

Commit:

```bash
git add docs/superpowers/specs/2026-07-01-ocr-image-schema-optimization-design.md
git commit -m "docs(spec): rollout result for OCR image optimization"
git push origin master
```

---

## Rollback Plan

**A2 masalah** (post-Task 5 shipping):
- `git revert` commit Task 2, 3, 4 (schema builder + gemini config + prompt trim). Push. `buildMenuRefText` come back via revert.
- OR: keep responseSchema builder tapi bring back `menuRefText` di prompt sebagai defense-in-depth.

**A1 masalah** (post-Task 10):
- Vercel env: flip `NEXT_PUBLIC_IMAGE_MAX_WIDTH` back to `1600`. Redeploy. Instant fix, no code revert.
- Kalau ada bug di parsing logic: `git revert` commit Task 7-9.

**Both work but accuracy still not enough?**
- Buka plan Phase 2 (template-aware client crop) — spec sudah ada di out-of-scope section.

---

## Success Criteria

- ✅ Input tokens avg drop dari 1691 → **1000-1200** (post-A2 + A1 at 800px)
- ✅ Monthly bill drop dari ~600k → **~350-400k IDR**
- ✅ `items_count` regression <5% di sample production
- ✅ `handwritten_total` correctness stable (0 kalau ga ada, expanded ribuan kalau ada)
- ✅ `ocr_conf_min` distribution tidak melorot >20% dari baseline
- ✅ Zero new error class di Vercel logs

---

## Self-Review Notes

- [x] **Spec coverage**:
  - A2 responseSchema: Tasks 1 (verify) → 2 (builder) → 3 (wire) → 4 (trim) → 5 (ship) → 6 (observe)
  - A1 image compress: Tasks 7 (env var) → 8 (docs) → 9 (ship) → 10 (rollout)
- [x] **Blocking verification**: Task 1 gate → skip A2 kalau verify negative
- [x] **No placeholders**: semua step ada code/command lengkap
- [x] **Type consistency**: `buildScanResponseSchema` return shape sama antara Task 2 (define) & Task 3 (consume via `responseSchema: responseSchema as any`)
- [x] **Ordering rationale**:
  - Verify dulu (Task 1) — hemat waktu kalau assumption salah
  - Builder + tests (Task 2) sebelum consume (Task 3)
  - gemini.ts (Task 3) sebelum prompts.ts cleanup (Task 4) supaya `buildMenuRefText` orphan bisa di-detect via TS/lint di Task 3 kalau caller masih ada
  - A2 fully shipped + observed sebelum A1 — supaya kalau A2 introduce regression tidak conflated dengan A1
  - A1 code ship default 1600 (no-op) → env-var flip terakhir, gradual
