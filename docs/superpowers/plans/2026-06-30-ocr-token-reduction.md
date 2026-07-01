# OCR Token Reduction + Single Model (No Retry) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce per-scan token usage di route `/api/scan` (~40% input + ~30% output) dan sederhanakan arsitektur OCR jadi **single-model, no-retry** — hapus fallback ke Pro, hapus tombol "Scan ulang dengan Pro" di review page, hapus endpoint + kolom DB pendukungnya.

**Architecture:** Tetap pakai `gemini-3.5-flash` sebagai satu-satunya model. Hapus `CAREFUL_MODEL`, fallback logic, `ScanOptions.mode`, route `/api/transactions/[id]/rescan`, dan kolom `transactions.rescanned_at`. Token reduction dicapai dengan: (a) menu list lebih ringkas (cuma nama, tanpa kategori/harga), (b) system prompt di-trim dari ~600 → ~300 token, (c) JSON output key di-shorten (`menu_name`→`m`, `qty`→`q`, dll) lalu Zod `.transform()` re-expand jadi shape lama supaya consumer code tidak perlu diubah.

**Tech Stack:** Next.js 16 App Router, TypeScript, `@google/genai`, Zod, Supabase (Postgres migration), Vitest.

---

## File Structure

**Modified:**
- `lib/prompts.ts` — trim `OCR_SYSTEM_PROMPT`, simplify `buildMenuRefText`, schema dengan short keys + transform
- `lib/prompts.test.ts` — update assertions untuk prompt/menu/schema baru
- `lib/gemini.ts` — hapus `CAREFUL_MODEL`, fallback path, `ScanOptions`. Single `callModel(FAST_MODEL)`.
- `components/nota-review-form.tsx` — hapus state `rescanning`, fungsi `handleRescan`, AlertDialog rescan, prop `rescanned_at`
- `app/(app)/transactions/[id]/review/page.tsx` — drop kolom `rescanned_at` dari query + prop
- `.env.local`, `.env.example` — hapus `GEMINI_CAREFUL_MODEL`
- `docs/spec.md` — update note model (cuma satu, no fallback)
- `docs/superpowers/specs/2026-06-20-pak-pon-design.md` — coret bagian fallback Pro

**Deleted:**
- `app/api/transactions/[id]/rescan/route.ts` — endpoint rescan
- (kolom `transactions.rescanned_at` via migration)

**Created:**
- `supabase/migrations/0027_drop_rescanned_at.sql` — drop kolom

---

## Token Reduction Targets

Baseline (dari log production, 2026-06-30, 6 items, 31 menus):
- Input: 2164 token
- Output: 366 token

Target after this plan:
- Input: ~1400 token (-35%)
  - Menu list: ~450 → ~200 (cuma nama)
  - System prompt: ~600 → ~300 (trim duplikasi)
  - Image: ~1100 (unchanged — out of scope)
- Output: ~250 token (-32%)
  - Short keys per item: ~60 → ~40 token
  - Short header keys

---

## Task 1: Migration drop `rescanned_at` column

**Files:**
- Create: `supabase/migrations/0027_drop_rescanned_at.sql`

- [ ] **Step 1: Write migration**

```sql
-- 0027_drop_rescanned_at.sql — hapus kolom rescan tracker
-- Konteks: per plan 2026-06-30 sistem OCR jadi single-model no-retry.
-- Route /api/transactions/[id]/rescan dan tombol UI sudah dihapus,
-- kolom ini tidak dipakai lagi.

ALTER TABLE transactions
  DROP COLUMN IF EXISTS rescanned_at;
```

- [ ] **Step 2: Apply migration ke Supabase**

Jalankan via Supabase MCP (atau `supabase db push` kalau pakai CLI local).
Expected: kolom `transactions.rescanned_at` tidak ada di schema.

Verifikasi:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name='transactions' AND column_name='rescanned_at';
-- Expected: 0 rows
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0027_drop_rescanned_at.sql
git commit -m "feat(db): drop transactions.rescanned_at (rescan removed)"
```

---

## Task 2: Hapus rescan API route

**Files:**
- Delete: `app/api/transactions/[id]/rescan/route.ts`

- [ ] **Step 1: Hapus file**

```bash
rm app/api/transactions/[id]/rescan/route.ts
rmdir app/api/transactions/[id]/rescan 2>/dev/null || true
```

- [ ] **Step 2: Pastikan tidak ada konsumen lain**

```bash
grep -rn "transactions.*rescan\|api/transactions/.*/rescan" \
  app components lib --include="*.ts" --include="*.tsx" | grep -v node_modules
```

Expected: no matches setelah Task 4 selesai. Untuk sekarang, masih ada match di `components/nota-review-form.tsx` (akan dihapus di Task 4).

- [ ] **Step 3: Build cek (jangan jalanin tes dulu, masih ada referensi UI)**

Run: `npm run lint`
Expected: no new lint errors di file yang berhubungan (typescript akan error karena UI masih panggil `/api/transactions/.../rescan` — itu OK, akan dibereskan di Task 4).

- [ ] **Step 4: Commit**

```bash
git add -A app/api/transactions/[id]/rescan
git commit -m "feat(api): remove rescan endpoint (single-model OCR, no retry)"
```

---

## Task 3: Hapus fallback model + ScanOptions dari `lib/gemini.ts`

**Files:**
- Modify: `lib/gemini.ts`

- [ ] **Step 1: Tulis test failing untuk single-attempt behavior**

Edit `lib/prompts.test.ts` — tambah file baru `lib/gemini.test.ts` (kalau belum ada). Skip kalau Vitest tidak nge-mock `@google/genai` dengan mudah; cukup andalkan static type check + manual smoke. Tapi mari kita pastikan: tidak ada export `ScanOptions` atau `CAREFUL_MODEL` lagi.

Run:
```bash
grep -n "ScanOptions\|CAREFUL_MODEL" lib/gemini.ts
```
Expected sekarang: 5+ matches. Setelah Task 3 selesai: 0 matches.

- [ ] **Step 2: Rewrite `lib/gemini.ts`**

Ganti seluruh isi file dengan:

```ts
import { GoogleGenAI } from '@google/genai';
import { buildScanSchema, buildMenuRefText, OCR_SYSTEM_PROMPT, type MenuRef, type ScanResult } from './prompts';

// Model selection — overridable via env (.env.local) untuk easy A/B.
// Single model only — fallback Pro dihapus per plan 2026-06-30.
const MODEL = process.env.GEMINI_FAST_MODEL ?? 'gemini-3.5-flash';

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export type ScanAttempt = {
  model: string;
  duration_ms: number;
  outcome: 'success' | 'api_error' | 'empty_response' | 'invalid_json' | 'schema_mismatch';

  error_message?: string;
  raw_text_preview?: string;
  schema_issues?: unknown[];
  items_count?: number;
  handwritten_total?: number;

  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

export type ScanMeta = {
  attempts: ScanAttempt[];
  final_model: string | null;
  fell_back: boolean; // selalu false sekarang — disimpan supaya log shape backward-compatible
};

export type ScanNotaResult = {
  result: ScanResult;
  meta: ScanMeta;
};

const EMPTY_RESULT: ScanResult = {
  items: [],
  handwritten_total: 0,
  customer_name: null,
  table_no: null,
};

function truncate(s: string, n = 400): string {
  return s.length > n ? s.slice(0, n) + `… [+${s.length - n} chars]` : s;
}

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
    attempt.duration_ms = Date.now() - t0;
    attempt.outcome = 'api_error';
    attempt.error_message = err instanceof Error ? err.message : String(err);
    attempts.push(attempt);
    return { result: EMPTY_RESULT, meta: { attempts, final_model: null, fell_back: false } };
  }

  attempt.duration_ms = Date.now() - t0;

  const usage = response.usageMetadata;
  if (usage) {
    attempt.input_tokens = usage.promptTokenCount;
    attempt.output_tokens = usage.candidatesTokenCount;
    attempt.total_tokens = usage.totalTokenCount;
  }

  const text = response.text;
  if (!text) {
    attempt.outcome = 'empty_response';
    attempts.push(attempt);
    return { result: EMPTY_RESULT, meta: { attempts, final_model: null, fell_back: false } };
  }

  attempt.raw_text_preview = truncate(text);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch (err) {
    attempt.outcome = 'invalid_json';
    attempt.error_message = err instanceof Error ? err.message : String(err);
    attempts.push(attempt);
    return { result: EMPTY_RESULT, meta: { attempts, final_model: null, fell_back: false } };
  }

  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success) {
    attempt.outcome = 'schema_mismatch';
    attempt.schema_issues = parsed.error.issues.slice(0, 6);
    attempts.push(attempt);
    return { result: EMPTY_RESULT, meta: { attempts, final_model: null, fell_back: false } };
  }

  attempt.items_count = parsed.data.items.length;
  attempt.handwritten_total = parsed.data.handwritten_total;
  attempts.push(attempt);

  return {
    result: parsed.data,
    meta: { attempts, final_model: MODEL, fell_back: false },
  };
}
```

- [ ] **Step 3: Verifikasi**

```bash
grep -n "ScanOptions\|CAREFUL_MODEL\|fastResult\|carefulResult" lib/gemini.ts
```
Expected: 0 matches.

```bash
npm run lint
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add lib/gemini.ts
git commit -m "feat(ocr): single-model only, drop fallback to Pro"
```

---

## Task 4: Hapus rescan UI dari `nota-review-form.tsx` + review page

**Files:**
- Modify: `components/nota-review-form.tsx`
- Modify: `app/(app)/transactions/[id]/review/page.tsx`

- [ ] **Step 1: Hapus `rescanned_at` dari prop `Transaction` di nota-review-form**

Edit `components/nota-review-form.tsx` line 29-37, hapus baris `rescanned_at`:

```ts
type Transaction = {
  id: string;
  status: 'pending_review' | 'confirmed';
  handwritten_total: number | null;
  customer_name: string | null;
  table_no: string | null;
  created_at: string;
};
```

- [ ] **Step 2: Hapus state + handler rescan**

Hapus baris ini di `nota-review-form.tsx`:
- Line ~177: `const [rescanning, setRescanning] = useState(false);`
- Line ~244-262: seluruh fungsi `async function handleRescan() { ... }`

- [ ] **Step 3: Hapus AlertDialog tombol rescan**

Di JSX (sekitar line 467-493), hapus seluruh block `<AlertDialog>...</AlertDialog>` yang trigger-nya "Scan ulang dengan Pro". Struktur sekitar:

```tsx
{scanUrl && (
  <div className="lg:sticky lg:top-4 lg:self-start space-y-3">
    <Card variant="paper" className="overflow-hidden">
      <ZoomableNotaImage ... />
    </Card>
    {/* HAPUS DARI SINI */}
    <AlertDialog>
      <AlertDialogTrigger ...>
        ...
      </AlertDialogTrigger>
      <AlertDialogContent>...</AlertDialogContent>
    </AlertDialog>
    {/* SAMPAI SINI */}
  </div>
)}
```

Setelah dihapus jadi:

```tsx
{scanUrl && (
  <div className="lg:sticky lg:top-4 lg:self-start">
    <Card variant="paper" className="overflow-hidden">
      <ZoomableNotaImage
        src={scanUrl}
        alt="Foto nota"
        imgClassName="mx-auto w-full object-contain max-h-72 lg:max-h-[calc(100vh-6rem)]"
      />
    </Card>
  </div>
)}
```

(Note: `space-y-3` di div luar boleh dihapus karena cuma satu anak sekarang.)

- [ ] **Step 4: Bersihkan referensi `rescanning` di disabled props**

Hapus `|| rescanning` dari kondisi `disabled` di:
- Line ~599: `disabled={pending || rescanning}` → `disabled={pending}`
- Line ~605: `disabled={pending || thousandsApplying || rescanning || items.length === 0}` → `disabled={pending || thousandsApplying || items.length === 0}`

- [ ] **Step 5: Hapus import AlertDialog* kalau tidak ada konsumen lain**

Cek dulu:
```bash
grep -n "AlertDialog" components/nota-review-form.tsx
```

Kalau setelah edit jadi 0 matches (selain di line import), hapus block import `AlertDialog*` dari line 10-20. Kalau masih ada konsumen lain (modal modifikasi pakai AlertDialog di line ~614), biarkan.

- [ ] **Step 6: Update review page query**

Edit `app/(app)/transactions/[id]/review/page.tsx`:

Line 22 — hapus `rescanned_at` dari select:
```ts
.select('id, status, handwritten_total, customer_name, table_no, created_at, scan_image_path')
```

Line 61 — hapus baris `rescanned_at: tx.rescanned_at,` dari prop transaction.

- [ ] **Step 7: Lint + build cek**

```bash
npm run lint
npm run build
```
Expected: clean. Kalau ada error tipe (TS) tentang `rescanning` atau `rescanned_at`, pastikan semua referensi sudah dihapus.

- [ ] **Step 8: Commit**

```bash
git add components/nota-review-form.tsx app/\(app\)/transactions/\[id\]/review/page.tsx
git commit -m "feat(ui): remove rescan button from review page"
```

---

## Task 5: Ringkas `buildMenuRefText` — cuma nama, no kategori/harga

**Files:**
- Modify: `lib/prompts.ts`
- Modify: `lib/prompts.test.ts`

- [ ] **Step 1: Update test failing dulu**

Edit `lib/prompts.test.ts` line 36-47 ganti jadi:

```ts
describe('buildMenuRefText', () => {
  it('lists menu names only (no category, no price)', () => {
    const text = buildMenuRefText(sampleMenus);
    expect(text).toContain('Pecel Lele');
    expect(text).toContain('Es Teh');
    // Token-saver: jangan kirim metadata yang tidak dipakai Gemini
    expect(text).not.toMatch(/makanan|minuman/);
    expect(text).not.toMatch(/Rp|16000|6000/);
  });
  it('returns a string even for empty menu list', () => {
    expect(typeof buildMenuRefText([])).toBe('string');
  });
});
```

- [ ] **Step 2: Run test → harus FAIL**

```bash
npm run test -- prompts.test.ts
```
Expected: 1 fail di `buildMenuRefText > lists menu names only` (current impl masih include category+price).

- [ ] **Step 3: Implementasi minimal**

Edit `lib/prompts.ts` line 37-43, ganti:

```ts
export function buildMenuRefText(menus: MenuRef[]): string {
  if (menus.length === 0) return 'Daftar menu master kosong.';
  const lines = menus.map((m) => `- ${m.name}`);
  return `Daftar menu master (gunakan nama PERSIS seperti tertulis di sini):\n${lines.join('\n')}`;
}
```

- [ ] **Step 4: Run test → harus PASS**

```bash
npm run test -- prompts.test.ts
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/prompts.ts lib/prompts.test.ts
git commit -m "perf(ocr): strip category+price from menu ref (~250 tok saved)"
```

---

## Task 6: Trim `OCR_SYSTEM_PROMPT`

**Files:**
- Modify: `lib/prompts.ts`
- Modify: `lib/prompts.test.ts`

- [ ] **Step 1: Update assertion tests supaya tetap robust ke prompt baru**

Tests yang ada (`mentions Pak Pon`, `confidence`, `alternatives`, `ribuan`, `mentah`, `miss`) sudah cek kata kunci — biarkan, mereka harusnya tetap pass. Tambah satu test untuk size budget:

Edit `lib/prompts.test.ts` di akhir `describe('OCR_SYSTEM_PROMPT', ...)` block, tambah:

```ts
  it('stays under ~1800 char (token budget guardrail)', () => {
    // Baseline 2026-06-30: prompt ~2400 char → ~600 tokens.
    // Target post-trim: <1800 char → ~300-400 tokens.
    expect(OCR_SYSTEM_PROMPT.length).toBeLessThan(1800);
  });
```

- [ ] **Step 2: Run test → guardrail FAIL, sisanya PASS**

```bash
npm run test -- prompts.test.ts
```
Expected: 1 fail di guardrail.

- [ ] **Step 3: Rewrite `OCR_SYSTEM_PROMPT` lebih ringkas**

Edit `lib/prompts.ts` line 10-32, ganti dengan:

```ts
export const OCR_SYSTEM_PROMPT = `OCR nota tulisan tangan warung Pak Pon. Kolom MENU pre-printed, qty ditulis tangan di kolom "Banyak nya". Cek SEMUA baris termasuk pensil tipis.

PRIORITAS: jangan miss item. Tebak qty/menu yang ragu daripada skip.

LOOK-ALIKE (pasangan yang sering tertukar — kalau kata penentu tidak terbaca jelas, confidence WAJIB <=70 + sertakan alternatives):
- "X goreng" vs "X bakar" (Ayam, Ayam Kampung, Bebek, Burung Dara, Nila)
- "Es X" vs "X panas" vs "X tawar" (Teh)

Output:
1. items[]: tiap baris dengan qty handwritten. Skip kalau qty kosong.
   - menu_name: HARUS persis dari daftar master di bawah.
   - qty: angka positif.
   - notes: anotasi handwritten (cth "PAHA", "tanpa sambel"). Kalau ga jelas, tulis mentahnya. null kalau kosong.
   - confidence (0-100, opsional): isi kalau ragu. Skip cuma kalau yakin >=95%.
   - alternatives (max 2 dari daftar master, opsional): sertakan untuk look-alike pairs.
2. handwritten_total: angka total bawah nota. SATUAN RIBUAN — "92"=92000. Return rupiah penuh, 0 kalau tidak terbaca.
3. customer_name, table_no: dari kolom "Nama" & "No. Meja". null kalau kosong.`;
```

Cek char count:
```bash
node -e "console.log(require('./lib/prompts').OCR_SYSTEM_PROMPT.length)"
```
Expected: < 1800.

- [ ] **Step 4: Run test → all PASS**

```bash
npm run test -- prompts.test.ts
```
Expected: all green termasuk:
- `mentions Pak Pon and is in Indonesian` — ✓ "Pak Pon" ada
- `mentions confidence as an optional per-item field` — ✓
- `mentions alternatives as an optional per-item field` — ✓
- `instructs AI that handwritten_total is in thousands` — ✓ "ribuan" ada
- `instructs AI to keep raw notes when uncertain` — ✓ "mentahnya" ada
- `prioritizes not missing items over per-item certainty` — ✓ "miss" ada
- `stays under ~1800 char (token budget guardrail)` — ✓

⚠️ Note: assertion `expect(OCR_SYSTEM_PROMPT.toLowerCase()).toContain('handwritten')` di test pertama. Prompt baru pakai kata "handwritten" gak? Cek:
```
"qty ditulis tangan" — gak ada 'handwritten'.
```
**Solution**: kembalikan kata "handwritten" — ganti "ditulis tangan" → "handwritten" (atau tambah "handwritten" satu kali di kalimat lain). Lebih clean: ganti kalimat pertama jadi:

```
OCR nota Pak Pon. Qty handwritten di kolom "Banyak nya"; cek SEMUA baris termasuk pensil tipis.
```

Kemudian rerun test → all green.

- [ ] **Step 5: Commit**

```bash
git add lib/prompts.ts lib/prompts.test.ts
git commit -m "perf(ocr): trim system prompt ~600→~300 tokens"
```

---

## Task 7: Short JSON keys di output schema + transform

**Files:**
- Modify: `lib/prompts.ts`
- Modify: `lib/prompts.test.ts`

**Strategy:** Gemini diminta output dengan key pendek (`m`, `q`, `n`, `c`, `a`, `t`, `cn`, `tn`). Zod schema pakai key pendek, lalu `.transform()` ke shape lama (`menu_name`, `qty`, dll) supaya consumer code (`scanNota`, route `/api/scan`, `/api/transactions/[id]/rescan` (sudah dihapus), tests) tidak perlu diubah.

- [ ] **Step 1: Tambah instruksi shorthand di prompt**

Edit `lib/prompts.ts` `OCR_SYSTEM_PROMPT` — ganti section "Output:" jadi:

```
Output JSON (PAKAI KEY PENDEK ini PERSIS):
{
  "i": [
    {"m": "<menu_name dari daftar master>", "q": <qty int positif>, "n": "<notes>"|null, "c": <0-100, OPSIONAL>, "a": [{"m":"<alt>"},...] max 2, OPSIONAL}
  ],
  "t": <handwritten_total rupiah penuh, "92"=92000, 0 kalau tidak terbaca>,
  "cn": "<customer_name>"|null,
  "tn": "<table_no>"|null
}

Aturan:
1. Item: tiap baris dengan qty handwritten. Skip kalau qty kosong. "m" HARUS persis dari daftar master.
2. notes "n": anotasi handwritten (cth "PAHA"). Kalau ga jelas, tulis mentahnya. null kalau kosong.
3. confidence "c" (0-100, opsional): isi kalau ragu. Skip cuma kalau yakin >=95%.
4. alternatives "a" (max 2 dari daftar master, opsional): sertakan untuk look-alike.
5. Total "t": SATUAN RIBUAN — "92"=92000.
```

Pastikan total prompt tetap < 1800 char. Kalau lewat, padatkan look-alike section.

- [ ] **Step 2: Tulis test failing untuk short-key schema**

Edit `lib/prompts.test.ts` — di akhir `describe('buildScanSchema', ...)`, tambah:

```ts
  it('accepts short-key shape from Gemini and transforms to long-key', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      i: [
        { m: 'Pecel Lele', q: 3, n: null },
        { m: 'Es Teh', q: 2, n: 'dingin', c: 60, a: [{ m: 'Pecel Lele' }] },
      ],
      t: 60000,
      cn: null,
      tn: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // Schema mentransformasi key pendek → key panjang sebelum consumer code
      expect(result.data.items[0].menu_name).toBe('Pecel Lele');
      expect(result.data.items[0].qty).toBe(3);
      expect(result.data.items[0].notes).toBeNull();
      expect(result.data.items[1].confidence).toBe(60);
      expect(result.data.items[1].alternatives?.[0]).toEqual({ menu_name: 'Pecel Lele' });
      expect(result.data.handwritten_total).toBe(60000);
      expect(result.data.customer_name).toBeNull();
      expect(result.data.table_no).toBeNull();
    }
  });

  it('rejects short-key with invalid menu name', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      i: [{ m: 'Burger', q: 1, n: null }],
      t: 0,
      cn: null,
      tn: null,
    });
    expect(result.success).toBe(false);
  });
```

Existing tests yang pakai long-key (`menu_name`, `qty`, dll) — **update juga**: ganti payload jadi short-key (`m`, `q`, ...). Contoh untuk `accepts valid Gemini-like response`:

```ts
  it('accepts valid Gemini-like response with confidence + alternatives', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      i: [
        { m: 'Pecel Lele', q: 3, n: null, c: 95, a: [] },
        { m: 'Es Teh', q: 2, n: 'dingin', c: 60, a: [{ m: 'Pecel Lele', c: 30 }] },
      ],
      t: 60000,
      cn: null,
      tn: null,
    });
    expect(result.success).toBe(true);
  });
```

Lakukan untuk SEMUA test di `describe('buildScanSchema', ...)` — ganti `menu_name`→`m`, `qty`→`q`, `notes`→`n`, `confidence`→`c`, `alternatives`→`a`, `handwritten_total`→`t`, `customer_name`→`cn`, `table_no`→`tn`. Test name boleh tetap, cuma payload yang diubah.

- [ ] **Step 3: Run test → harus FAIL**

```bash
npm run test -- prompts.test.ts
```
Expected: banyak fail di `buildScanSchema` block karena schema belum kenal short keys.

- [ ] **Step 4: Implementasi schema dengan short keys + transform**

Edit `lib/prompts.ts` — ganti seluruh fungsi `buildScanSchema`:

```ts
export function buildScanSchema(menus: MenuRef[]) {
  const menuNames = menus.map((m) => m.name);

  const menuNameSchema =
    menuNames.length > 0
      ? z.enum(menuNames as [string, ...string[]])
      : z.string();

  const confidenceSchema = z.number().int().min(0).max(100);

  // Alternatives bisa berbentuk { m, c? } (recommended) atau string shorthand
  // ("MenuName") — coerce string → { m } sebelum validasi.
  const altItemSchema = z.preprocess(
    (v) => (typeof v === 'string' ? { m: v } : v),
    z.object({
      m: menuNameSchema,
      c: confidenceSchema.optional(),
    })
  );

  return z.object({
    i: z.array(
      z.object({
        m: menuNameSchema,
        q: z.number().int().positive(),
        n: z.string().nullable(),
        c: confidenceSchema.optional(),
        a: z.array(altItemSchema).max(2).optional(),
      })
    ),
    t: z.number().int().nonnegative(),
    cn: z.string().nullable(),
    tn: z.string().nullable(),
  }).transform((d) => ({
    items: d.i.map((it) => ({
      menu_name: it.m,
      qty: it.q,
      notes: it.n,
      confidence: it.c,
      alternatives: it.a?.map((a) => ({
        menu_name: a.m,
        confidence: a.c,
      })),
    })),
    handwritten_total: d.t,
    customer_name: d.cn,
    table_no: d.tn,
  }));
}

export type ScanResult = z.infer<ReturnType<typeof buildScanSchema>>;
```

- [ ] **Step 5: Run test → harus PASS**

```bash
npm run test -- prompts.test.ts
```
Expected: all green.

- [ ] **Step 6: Sanity check consumer code masih kompatibel**

Cek route handler `/api/scan/route.ts` baris-baris yang akses `ocr.items[i].menu_name`, `ocr.handwritten_total`, dll — semua harusnya tetap jalan karena `.transform()` re-expand ke shape lama.

```bash
npm run build
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/prompts.ts lib/prompts.test.ts
git commit -m "perf(ocr): short JSON keys + Zod transform (~100 out-tok saved)"
```

---

## Task 8: Update `.env` files + docs

**Files:**
- Modify: `.env.local`
- Modify: `.env.example`
- Modify: `docs/spec.md`
- Modify: `docs/superpowers/specs/2026-06-20-pak-pon-design.md`

- [ ] **Step 1: Hapus `GEMINI_CAREFUL_MODEL` dari `.env.local`**

Edit `.env.local` line 6, hapus baris:
```
GEMINI_CAREFUL_MODEL=gemini-2.5-pro
```

- [ ] **Step 2: Hapus `GEMINI_CAREFUL_MODEL` dari `.env.example`**

Edit `.env.example` line 11-14, ganti jadi (cuma satu model now):

```
# Override default Gemini model untuk OCR (optional)
# Default: gemini-3.5-flash
# Examples: gemini-2.5-flash (cheap), gemini-3.5-flash (better accuracy)
# GEMINI_FAST_MODEL=gemini-3.5-flash
```

- [ ] **Step 3: Update `docs/spec.md`**

Edit `docs/spec.md` line 10, ganti:
```
- Gemini `gemini-3.5-flash` (fallback `gemini-3.1-pro-preview`) untuk OCR
```
jadi:
```
- Gemini `gemini-3.5-flash` untuk OCR (single model, no retry)
```

- [ ] **Step 4: Update design spec**

Edit `docs/superpowers/specs/2026-06-20-pak-pon-design.md`:

Line ~85 — row "Gemini model":
```
| 10 | Gemini model | `gemini-3.5-flash` only — single attempt, no fallback (lihat plan 2026-06-30-ocr-token-reduction.md) | Latency 2-5 dtk |
```

Line ~346:
```
- **Primary**: `gemini-3.5-flash` (latency 2-5s, low cost, supports structured JSON via responseSchema)
- **No fallback**: per plan 2026-06-30 — kalau Flash gagal, request return EMPTY_RESULT; kasir bisa hapus tx + scan ulang manual via /scan
```

Line ~397 onwards — coret/replace block contoh code yang panggil `gemini-2.5-pro` sebagai fallback. Cukup catat: "Fallback ke Pro dihapus 2026-06-30 — lihat plan."

- [ ] **Step 5: Commit**

```bash
git add .env.local .env.example docs/spec.md docs/superpowers/specs/2026-06-20-pak-pon-design.md
git commit -m "docs: update OCR single-model arch + drop GEMINI_CAREFUL_MODEL"
```

---

## Task 9: Full regression test + smoke run

**Files:** none (verifikasi only)

- [ ] **Step 1: Full test suite**

```bash
npm run test
```
Expected: all green.

- [ ] **Step 2: Build production**

```bash
npm run build
```
Expected: clean, no TS error, no warning baru tentang `rescanned_at` atau `ScanOptions`.

- [ ] **Step 3: Lint**

```bash
npm run lint
```
Expected: clean.

- [ ] **Step 4: Dev server smoke test**

```bash
npm run dev
```

Lalu di browser:
1. Login
2. Buka `/scan`, upload foto nota
3. Cek di Vercel logs / terminal log: cari event `POST /api/scan` — pastikan `ocr_attempts[0].input_tokens` turun signifikan (target: ~1400, baseline 2164)
4. Buka transaction review page — pastikan tidak ada tombol "Scan ulang dengan Pro"
5. Cek bahwa data tersimpan dengan benar (item names, qty, total) — schema transform jalan

- [ ] **Step 5: Cek log production (1 hari setelah deploy)**

Lihat 5-10 sample log `POST /api/scan` di Vercel logs:
- `input_tokens`: target avg ~1400
- `output_tokens`: target avg ~250
- `total_tokens`: target avg ~1650 vs baseline 2530 (-35%)

Kalau token reduction sesuai target → close plan. Kalau di atas target (>1800 input atau >300 output), trace ke prompt size atau output verbosity.

- [ ] **Step 6: Commit (kalau ada small fixes)**

Skip kalau tidak ada perubahan tambahan.

---

## Out of Scope (future plans)

1. **Image resolution reduction** (1600→1024px) — bisa save 500+ token, tapi risk akurasi handwritten qty. Butuh A/B test dengan dataset foto nota real. Rencanakan plan terpisah.
2. **Gemini context caching** — system prompt + menu list ~500 token (post-trim), di bawah minimum 1024 token Flash. Not viable kecuali padding atau switch ke Pro.
3. **Drop `alternatives` field entirely** — hilangkan look-alike flagging. Tidak dilakukan karena justru fitur penting buat kasir (anti-tertukar Ayam goreng vs bakar).

---

## Rollback Plan

Kalau token reduction menyebabkan akurasi OCR drop drastis (e.g., missed items naik >10%):

1. `git revert` commit terkait Task 5/6/7 (prompt+schema)
2. **Jangan revert** Task 1/2/3/4/8 (rescan removal + DB cleanup) — itu independen dari token reduction
3. Kalau rescan dibutuhkan lagi, restore via fresh migration + re-add endpoint (jangan unrevert; commit baru lebih jelas history-nya)

---

## Self-Review Notes

- [x] **Spec coverage**: token reduction (Task 5,6,7), single-model (Task 3), no retry UI (Task 4), API removal (Task 2), DB cleanup (Task 1), docs+env (Task 8), verification (Task 9)
- [x] **No placeholders**: semua step ada code/command lengkap
- [x] **Type consistency**: `ScanResult` shape tidak berubah (transform jaga backward compat); `Transaction` type kehilangan `rescanned_at` konsisten di review page + form prop
- [x] **Ordering rationale**: DB drop dulu (Task 1) aman karena no FK; API removal (Task 2) sebelum UI cleanup (Task 4) supaya test build error gate jelas; gemini.ts refactor (Task 3) independen; prompt+schema changes (5,6,7) di-batch karena saling terkait test
