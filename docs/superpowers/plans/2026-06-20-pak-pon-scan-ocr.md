# Pak Pon — Plan 2: Scan + OCR + Review + Save

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Working flow dimana kasir foto nota di `/scan` → otomatis di-compress + di-OCR oleh Gemini 3.5 Flash → dialihkan ke `/transactions/[id]/review` untuk edit/konfirmasi → tersimpan sebagai transaksi dengan `status='confirmed'`.

**Architecture:** All-server-mediated upload flow (per spec §3 Q12). Browser compress foto pakai `browser-image-compression`, POST FormData ke `/api/scan`. Server upload ke Supabase Storage (`notas/yyyy-mm/<tx-id>.jpg`), call Gemini dengan menu master sebagai enum reference, insert draft `transactions` (status=pending_review) + `transaction_items`, return transaction_id. Review page fetch via `/api/transactions/[id]` dengan signed URL untuk foto, edit lewat modal, konfirmasi via PATCH (replace items strategy yang preserve snapshot price untuk item existing).

**Tech Stack:** Next.js 16 App Router · `@google/genai` (Gemini SDK terbaru) · `browser-image-compression` · Zod · Supabase Storage signed URLs · Tailwind v4 design tokens dari Plan 1.

**Source spec:** `docs/superpowers/specs/2026-06-20-pak-pon-design.md` (§3-§8 utama)

**Prerequisites:**
- Plan 1 selesai (Foundation, Auth, Menu Master live)
- `GEMINI_API_KEY` harus diisi di `.env.local` (user generate dari https://aistudio.google.com/apikey) + di Vercel env vars sebelum production deploy

---

## File map

```
pak-pon/
├── lib/
│   ├── compress.ts                              # (T2) client-side image compression wrapper
│   ├── prompts.ts                               # (T3) OCR prompt + Zod schema builder
│   ├── prompts.test.ts                          # (T3) schema builder tests
│   ├── gemini.ts                                # (T4) Gemini SDK init + scanNota with fallback
│   └── transactions.ts                          # (T6) computeItemDiff pure helper + tests
│   └── transactions.test.ts                     # (T6) diff logic tests
├── app/
│   ├── api/
│   │   ├── scan/route.ts                        # (T5) POST: upload + OCR + insert draft
│   │   └── transactions/
│   │       └── [id]/route.ts                    # (T7) GET single + PATCH (replace items, confirm)
│   └── (app)/
│       ├── scan/page.tsx                        # (T9) photo capture page
│       └── transactions/
│           └── [id]/
│               └── review/page.tsx              # (T12) review screen (server component)
├── components/
│   ├── photo-uploader.tsx                       # (T8) file input + preview + compress + upload
│   ├── nota-item-row.tsx                        # (T10) one row in review list
│   ├── nota-item-modal.tsx                      # (T11) add/edit item modal
│   └── nota-review-form.tsx                     # (T11) review screen orchestrator (client)
└── vercel.json                                  # (T1) update with maxDuration for /api/scan
```

**One-file responsibility:** `lib/transactions.ts` holds the pure replace-items diff so it's unit-testable independent of Supabase. `lib/gemini.ts` is the only file calling Gemini, with one named export `scanNota`. UI components separate display row, modal, and orchestrator.

---

## Task 1: Install deps + env vars + vercel.json update

**Files:**
- Modify: `package.json` (deps added)
- Modify: `vercel.json`
- Modify: `.env.local` (manual: user adds `GEMINI_API_KEY` value)

- [ ] **Step 1.1: Install runtime dependencies**

```bash
npm install @google/genai browser-image-compression
```

Verify `package.json` `dependencies` mengandung `@google/genai` dan `browser-image-compression`.

- [ ] **Step 1.2: Update `vercel.json` dengan function timeout untuk `/api/scan`**

Replace seluruh isi `vercel.json` dengan:

```json
{
  "framework": "nextjs",
  "regions": ["sin1"],
  "functions": {
    "app/api/scan/route.ts": {
      "maxDuration": 60
    }
  }
}
```

> OCR call butuh waktu lebih (~5-15s normal, fallback Pro ~15-30s). Default Vercel function 300s sebenarnya cukup tapi kita explicit pakai 60s sebagai safety net.

- [ ] **Step 1.3: User adds GEMINI_API_KEY to local env (manual instruction)**

User-facing instruction yang harus disampaikan ke human:
> Buka https://aistudio.google.com/apikey, buat API key baru (gratis), copy, lalu edit `.env.local` baris `GEMINI_API_KEY=` dengan paste key tersebut. JANGAN commit `.env.local`.

Jangan modify `.env.local` sendiri di automation — biarkan human paste key-nya.

- [ ] **Step 1.4: Verify build still passes**

```bash
npm run build
```

Expected: success, no new errors.

- [ ] **Step 1.5: Commit**

```bash
git add package.json package-lock.json vercel.json
git commit -m "chore(plan2): install Gemini SDK + image compression + vercel function timeout"
```

---

## Task 2: `lib/compress.ts` — client-side image compression

**Files:**
- Create: `lib/compress.ts`

> **TDD note:** `browser-image-compression` butuh canvas API (browser-only). Sulit di-unit-test di vitest jsdom karena canvas tidak fully polyfilled. Verify dengan manual run di Task 9, skip explicit test.

- [ ] **Step 2.1: Implement `lib/compress.ts`**

```ts
import imageCompression from 'browser-image-compression';

/**
 * Compress foto nota di browser sebelum upload.
 * Target: 1600px max dimension, JPEG quality 0.8 → biasanya 200-500 KB dari 3-5 MB asli.
 * Dipanggil dari PhotoUploader sebelum POST /api/scan.
 */
export async function compressNotaImage(file: File): Promise<File> {
  return imageCompression(file, {
    maxSizeMB: 0.5,
    maxWidthOrHeight: 1600,
    useWebWorker: true,
    fileType: 'image/jpeg',
    initialQuality: 0.8,
  });
}
```

- [ ] **Step 2.2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 2.3: Commit**

```bash
git add lib/compress.ts
git commit -m "feat(lib): compressNotaImage helper for client-side resize"
```

---

## Task 3: `lib/prompts.ts` — OCR system prompt + Zod schema builder

**Files:**
- Create: `lib/prompts.ts`
- Create: `lib/prompts.test.ts`

- [ ] **Step 3.1: Write failing tests**

Create `lib/prompts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildScanSchema, buildMenuRefText, OCR_SYSTEM_PROMPT } from './prompts';

const sampleMenus = [
  { id: 'a', name: 'Pecel Lele', category: 'makanan', price: 16000 },
  { id: 'b', name: 'Es Teh',     category: 'minuman', price: 6000 },
];

describe('OCR_SYSTEM_PROMPT', () => {
  it('mentions Pak Pon and is in Indonesian', () => {
    expect(OCR_SYSTEM_PROMPT).toContain('Pak Pon');
    expect(OCR_SYSTEM_PROMPT.toLowerCase()).toContain('handwritten');
  });
});

describe('buildMenuRefText', () => {
  it('lists menus with price + category', () => {
    const text = buildMenuRefText(sampleMenus);
    expect(text).toContain('Pecel Lele');
    expect(text).toContain('makanan');
    expect(text).toContain('16000');
    expect(text).toContain('Es Teh');
  });
  it('returns a string even for empty menu list', () => {
    expect(typeof buildMenuRefText([])).toBe('string');
  });
});

describe('buildScanSchema', () => {
  it('accepts valid Gemini-like response', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      items: [
        { menu_name: 'Pecel Lele', qty: 3, notes: null },
        { menu_name: 'Es Teh', qty: 2, notes: 'dingin' },
      ],
      handwritten_total: 60000,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(true);
  });
  it('rejects menu_name not in master list', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      items: [{ menu_name: 'Burger', qty: 1, notes: null }],
      handwritten_total: 50000,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(false);
  });
  it('rejects qty < 1', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      items: [{ menu_name: 'Pecel Lele', qty: 0, notes: null }],
      handwritten_total: 0,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(false);
  });
  it('handles empty menu list (no scan possible — schema still valid for empty result)', () => {
    const schema = buildScanSchema([]);
    const result = schema.safeParse({
      items: [],
      handwritten_total: 0,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 3.2: Run failing tests**

```bash
npm run test -- lib/prompts.test.ts
```

Expected: FAIL "Failed to resolve import './prompts'".

- [ ] **Step 3.3: Implement `lib/prompts.ts`**

```ts
import { z } from 'zod';

export type MenuRef = {
  id: string;
  name: string;
  category: 'makanan' | 'nasi' | 'minuman';
  price: number;
};

export const OCR_SYSTEM_PROMPT = `Anda adalah OCR untuk nota warung Pecel Lele Pak Pon.

Format nota: kolom MENU sudah pre-printed di kertas nota dengan harga. Kasir mengisi tulisan tangan angka di kolom "Banyak nya" untuk setiap item yang dipesan, dan total di bawah nota.

Tugas Anda:
1. Ekstrak HANYA item yang punya angka qty (tulisan tangan) di sebelahnya. Abaikan baris menu yang qty-nya kosong.
2. Anotasi tulisan tangan di sebelah nama menu (cth: "D P", "Dada", "tanpa sambel") masuk ke field "notes". Kosongkan kalau tidak ada.
3. handwritten_total = angka total yang ditulis tangan di bagian bawah nota. 0 kalau tidak terbaca.
4. customer_name dan table_no = isi dari kolom "Nama" dan "No. Meja" di atas nota — null kalau kosong.

PENTING: Field "menu_name" HARUS PERSIS sama dengan salah satu nama menu di daftar master di bawah. Jangan paraphrase, jangan terjemahkan, jangan singkat.`;

/**
 * Build the text portion that gives Gemini the menu master as reference.
 * Used together with OCR_SYSTEM_PROMPT.
 */
export function buildMenuRefText(menus: MenuRef[]): string {
  if (menus.length === 0) return 'Daftar menu master kosong.';
  const lines = menus.map(
    (m) => `- ${m.name} (${m.category}) Rp${m.price}`
  );
  return `Daftar menu master (gunakan nama PERSIS seperti tertulis di sini):\n${lines.join('\n')}`;
}

/**
 * Build a Zod schema where menu_name is constrained to the master list (enum).
 * Memaksa Gemini memilih dari daftar valid → mencegah hallucination.
 */
export function buildScanSchema(menus: MenuRef[]) {
  const menuNames = menus.map((m) => m.name);

  // If menu list is empty, allow any string (won't match anything valid anyway).
  // This avoids Zod error on empty enum.
  const menuNameSchema =
    menuNames.length > 0
      ? z.enum(menuNames as [string, ...string[]])
      : z.string();

  return z.object({
    items: z.array(
      z.object({
        menu_name: menuNameSchema,
        qty: z.number().int().positive(),
        notes: z.string().nullable(),
      })
    ),
    handwritten_total: z.number().int().nonnegative(),
    customer_name: z.string().nullable(),
    table_no: z.string().nullable(),
  });
}

export type ScanResult = z.infer<ReturnType<typeof buildScanSchema>>;
```

- [ ] **Step 3.4: Run tests — verify pass**

```bash
npm run test -- lib/prompts.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add lib/prompts.ts lib/prompts.test.ts
git commit -m "feat(lib): OCR prompt + Zod schema builder with menu enum constraint"
```

---

## Task 4: `lib/gemini.ts` — Gemini SDK wrapper with fallback

**Files:**
- Create: `lib/gemini.ts`

> Hard to unit-test without mocking Gemini API. Integration verified at T5 (api/scan) manual run.

- [ ] **Step 4.1: Check current `@google/genai` API surface**

Read first 80 lines of installed SDK types to confirm function signatures haven't drifted from this plan's assumptions:

```bash
sed -n '1,80p' node_modules/@google/genai/dist/web/index.d.ts 2>/dev/null || sed -n '1,80p' node_modules/@google/genai/dist/types.d.ts 2>/dev/null
```

Look for: how `GoogleGenAI` is instantiated, how `generateContent` is called, what the response shape is. The implementation in Step 4.2 uses the modern `client.models.generateContent({...})` API; adapt to actual installed signature if it differs.

- [ ] **Step 4.2: Implement `lib/gemini.ts`**

```ts
import { GoogleGenAI } from '@google/genai';
import { buildScanSchema, buildMenuRefText, OCR_SYSTEM_PROMPT, type MenuRef, type ScanResult } from './prompts';

const PRIMARY_MODEL = 'gemini-3.5-flash';
const FALLBACK_MODEL = 'gemini-3.1-pro-preview';

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

/**
 * OCR sebuah foto nota.
 * - Try PRIMARY_MODEL (Flash) dulu — cepat & murah.
 * - Kalau hasil "kosong" (items kosong DAN handwritten_total = 0), retry sekali pakai FALLBACK_MODEL (Pro).
 * - Return parsed result, throw kalau dua-duanya gagal.
 */
export async function scanNota(
  base64Image: string,
  mimeType: string,
  menus: MenuRef[]
): Promise<ScanResult> {
  const schema = buildScanSchema(menus);
  const menuRefText = buildMenuRefText(menus);

  async function callModel(model: string): Promise<ScanResult> {
    const response = await client.models.generateContent({
      model,
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
        thinkingConfig: { thinkingBudget: 0 }, // setara thinking_level: 'minimal'
      },
    });

    const text = response.text;
    if (!text) throw new Error('gemini-empty-response');

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      throw new Error('gemini-invalid-json');
    }

    const parsed = schema.safeParse(parsedJson);
    if (!parsed.success) throw new Error('gemini-schema-mismatch');
    return parsed.data;
  }

  // Try Flash first
  let result: ScanResult;
  try {
    result = await callModel(PRIMARY_MODEL);
  } catch (err) {
    // Flash threw → try Pro
    return await callModel(FALLBACK_MODEL);
  }

  // Flash returned but result is empty → escalate to Pro
  if (result.items.length === 0 && result.handwritten_total === 0) {
    try {
      return await callModel(FALLBACK_MODEL);
    } catch {
      // Pro also failed → return Flash's empty result. Kasir bisa input manual.
      return result;
    }
  }

  return result;
}
```

> If the `@google/genai` SDK installed has a different surface (e.g. `client.generativeModel(...)` instead of `client.models.generateContent({...})`), adapt the call sites. The wrapper interface (`scanNota`) stays the same.

- [ ] **Step 4.3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors. If error, the SDK signature differs from this plan — read SDK types and adapt.

- [ ] **Step 4.4: Commit**

```bash
git add lib/gemini.ts
git commit -m "feat(lib): Gemini scanNota wrapper with Pro fallback on empty Flash result"
```

---

## Task 5: `app/api/scan/route.ts` — POST handler

**Files:**
- Create: `app/api/scan/route.ts`

- [ ] **Step 5.1: Implement POST handler**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSupabaseServer } from '@/lib/supabase/server';
import { scanNota } from '@/lib/gemini';
import type { MenuRef } from '@/lib/prompts';

const STORAGE_BUCKET = 'notas';

export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // 1. Read multipart form
  const formData = await request.formData();
  const image = formData.get('image');
  if (!(image instanceof File)) {
    return NextResponse.json({ error: 'image_missing' }, { status: 400 });
  }
  if (!image.type.startsWith('image/')) {
    return NextResponse.json({ error: 'not_an_image' }, { status: 400 });
  }
  if (image.size === 0) {
    return NextResponse.json({ error: 'image_empty' }, { status: 400 });
  }

  // 2. Generate IDs + storage path
  const transactionId = randomUUID();
  const now = new Date();
  const yyyymm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const storagePath = `${yyyymm}/${transactionId}.jpg`;

  // 3. Upload to Supabase Storage
  const imageBuffer = await image.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, imageBuffer, {
      contentType: 'image/jpeg',
      upsert: false,
    });
  if (uploadError) {
    return NextResponse.json({ error: 'upload_failed', details: uploadError.message }, { status: 500 });
  }

  // 4. Fetch active menus for OCR enum
  const { data: menusData, error: menusError } = await supabase
    .from('menus')
    .select('id, name, category, price')
    .eq('is_active', true)
    .order('category')
    .order('name');
  if (menusError || !menusData) {
    return NextResponse.json({ error: 'menu_fetch_failed' }, { status: 500 });
  }
  const menus: MenuRef[] = menusData;

  // 5. Call Gemini OCR
  let ocr;
  try {
    const base64 = Buffer.from(imageBuffer).toString('base64');
    ocr = await scanNota(base64, 'image/jpeg', menus);
  } catch (err) {
    // Storage already uploaded — keep it, fallback to empty draft so user can input manually
    ocr = {
      items: [],
      handwritten_total: 0,
      customer_name: null,
      table_no: null,
    };
  }

  // 6. Resolve menu_name → menu_id + snapshot price; build items rows
  const menuByName = new Map(menus.map((m) => [m.name, m]));
  const itemRows = ocr.items
    .map((item, idx) => {
      const menu = menuByName.get(item.menu_name);
      if (!menu) return null; // shouldn't happen due to enum, but defensive
      return {
        transaction_id: transactionId,
        menu_id: menu.id,
        menu_name_snapshot: menu.name,
        unit_price_snapshot: menu.price,
        qty: item.qty,
        notes: item.notes,
        sort_order: idx,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // 7. Insert transaction header (status=pending_review)
  const { error: txError } = await supabase.from('transactions').insert({
    id: transactionId,
    scan_image_path: storagePath,
    handwritten_total: ocr.handwritten_total || null,
    status: 'pending_review',
    customer_name: ocr.customer_name,
    table_no: ocr.table_no,
  });
  if (txError) {
    return NextResponse.json({ error: 'tx_insert_failed', details: txError.message }, { status: 500 });
  }

  // 8. Insert items (if any)
  if (itemRows.length > 0) {
    const { error: itemsError } = await supabase.from('transaction_items').insert(itemRows);
    if (itemsError) {
      // tx is in DB but items failed — return tx_id anyway, user can edit
      return NextResponse.json(
        { transaction_id: transactionId, partial_error: 'items_insert_failed' },
        { status: 207 }
      );
    }
  }

  // 9. Return for client redirect
  const computedSum = itemRows.reduce((acc, it) => acc + it.qty * it.unit_price_snapshot, 0);
  const mismatch = !!ocr.handwritten_total && computedSum !== ocr.handwritten_total;
  return NextResponse.json(
    {
      transaction_id: transactionId,
      item_count: itemRows.length,
      handwritten_total: ocr.handwritten_total,
      computed_sum: computedSum,
      mismatch,
    },
    { status: 201 }
  );
}
```

- [ ] **Step 5.2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5.3: Verify build**

```bash
npm run build
```

Expected: `/api/scan` listed in route tree as `ƒ`.

- [ ] **Step 5.4: Commit**

```bash
git add app/api/scan/route.ts
git commit -m "feat(api): /api/scan POST — upload + Gemini OCR + insert draft transaction"
```

---

## Task 6: `lib/transactions.ts` — pure replace-items diff helper + tests

**Files:**
- Create: `lib/transactions.ts`
- Create: `lib/transactions.test.ts`

The PATCH endpoint must implement the "replace items strategy" per spec §7. Item dengan `id` matching existing → preserve `unit_price_snapshot`; item baru → snapshot current `menus.price`. Extract this to a pure function so we can test it without mocking Supabase.

- [ ] **Step 6.1: Write failing tests**

Create `lib/transactions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeReplaceItems, type ExistingItem, type RequestedItem, type MenuRef } from './transactions';

const menus: MenuRef[] = [
  { id: 'menu-pecel', name: 'Pecel Lele', price: 16000 },
  { id: 'menu-nasi',  name: 'Nasi',       price: 7000 },
];

const existing: ExistingItem[] = [
  { id: 'item-1', menu_id: 'menu-pecel', unit_price_snapshot: 15000, qty: 2, notes: null,   sort_order: 0 },
  { id: 'item-2', menu_id: 'menu-nasi',  unit_price_snapshot: 6500,  qty: 3, notes: 'less', sort_order: 1 },
];

describe('computeReplaceItems', () => {
  it('preserves snapshot price for items with matching id', () => {
    const requested: RequestedItem[] = [
      { id: 'item-1', menu_id: 'menu-pecel', qty: 4, notes: null, sort_order: 0 },
    ];
    const result = computeReplaceItems({ existing, requested, menus });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].unit_price_snapshot).toBe(15000); // preserved
    expect(result.rows[0].qty).toBe(4); // updated
    expect(result.rows[0].menu_name_snapshot).toBe('Pecel Lele');
  });

  it('snapshots current menu price for new items (no id)', () => {
    const requested: RequestedItem[] = [
      { menu_id: 'menu-pecel', qty: 1, notes: 'extra sambel', sort_order: 0 },
    ];
    const result = computeReplaceItems({ existing, requested, menus });
    expect(result.rows[0].unit_price_snapshot).toBe(16000); // current price
    expect(result.rows[0].notes).toBe('extra sambel');
  });

  it('omits items whose id was in existing but not in requested (effective delete)', () => {
    // requested only mentions item-1; item-2 should be dropped
    const requested: RequestedItem[] = [
      { id: 'item-1', menu_id: 'menu-pecel', qty: 1, notes: null, sort_order: 0 },
    ];
    const result = computeReplaceItems({ existing, requested, menus });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].menu_id).toBe('menu-pecel');
  });

  it('rejects requested item referencing unknown menu_id', () => {
    const requested: RequestedItem[] = [
      { menu_id: 'menu-nonexistent', qty: 1, notes: null, sort_order: 0 },
    ];
    expect(() => computeReplaceItems({ existing, requested, menus })).toThrow(/unknown menu/i);
  });

  it('handles requested id that does not match any existing — treats as new', () => {
    const requested: RequestedItem[] = [
      { id: 'fake-id', menu_id: 'menu-nasi', qty: 5, notes: null, sort_order: 0 },
    ];
    const result = computeReplaceItems({ existing, requested, menus });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].unit_price_snapshot).toBe(7000); // current snapshot, not preserved
  });

  it('returns sort_order from requested', () => {
    const requested: RequestedItem[] = [
      { menu_id: 'menu-pecel', qty: 1, notes: null, sort_order: 5 },
      { menu_id: 'menu-nasi',  qty: 1, notes: null, sort_order: 3 },
    ];
    const result = computeReplaceItems({ existing, requested, menus });
    expect(result.rows[0].sort_order).toBe(5);
    expect(result.rows[1].sort_order).toBe(3);
  });
});
```

- [ ] **Step 6.2: Run tests — verify fail**

```bash
npm run test -- lib/transactions.test.ts
```

Expected: FAIL "Failed to resolve import './transactions'".

- [ ] **Step 6.3: Implement `lib/transactions.ts`**

```ts
export type MenuRef = {
  id: string;
  name: string;
  price: number;
};

export type ExistingItem = {
  id: string;
  menu_id: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  sort_order: number;
};

export type RequestedItem = {
  id?: string;
  menu_id: string;
  qty: number;
  notes: string | null;
  sort_order: number;
};

export type ItemRow = {
  menu_id: string;
  menu_name_snapshot: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  sort_order: number;
};

export type ReplaceItemsResult = {
  rows: ItemRow[];
};

/**
 * Compute rows untuk "replace items" PATCH transaksi.
 *
 * Untuk setiap requested item:
 * - Kalau punya `id` yang cocok dengan existing → preserve `unit_price_snapshot` lama
 * - Kalau no `id` atau id tidak cocok → snapshot harga sekarang dari menus
 *
 * Item existing yang tidak disebut di requested = effective delete (dilakukan dengan
 * DELETE all + INSERT new di caller).
 *
 * Throw kalau ada requested item dengan menu_id yang tidak ada di menus.
 */
export function computeReplaceItems(input: {
  existing: ExistingItem[];
  requested: RequestedItem[];
  menus: MenuRef[];
}): ReplaceItemsResult {
  const existingById = new Map(input.existing.map((e) => [e.id, e]));
  const menuById = new Map(input.menus.map((m) => [m.id, m]));

  const rows: ItemRow[] = input.requested.map((req) => {
    const menu = menuById.get(req.menu_id);
    if (!menu) {
      throw new Error(`Unknown menu_id: ${req.menu_id}`);
    }

    // Preserve snapshot price untuk item existing
    const matchedExisting = req.id ? existingById.get(req.id) : undefined;
    const unit_price_snapshot = matchedExisting?.unit_price_snapshot ?? menu.price;

    return {
      menu_id: menu.id,
      menu_name_snapshot: menu.name,
      unit_price_snapshot,
      qty: req.qty,
      notes: req.notes,
      sort_order: req.sort_order,
    };
  });

  return { rows };
}
```

- [ ] **Step 6.4: Run tests — verify pass**

```bash
npm run test -- lib/transactions.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 6.5: Commit**

```bash
git add lib/transactions.ts lib/transactions.test.ts
git commit -m "feat(lib): computeReplaceItems pure helper for PATCH items strategy"
```

---

## Task 7: `app/api/transactions/[id]/route.ts` — GET + PATCH

**Files:**
- Create: `app/api/transactions/[id]/route.ts`

- [ ] **Step 7.1: Implement GET + PATCH**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { computeReplaceItems, type ExistingItem, type MenuRef } from '@/lib/transactions';

const STORAGE_BUCKET = 'notas';
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 jam
const NOT_FOUND_CODE = 'PGRST116';

const PatchSchema = z.object({
  status: z.enum(['pending_review', 'confirmed']).optional(),
  customer_name: z.string().nullable().optional(),
  table_no: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        menu_id: z.string().uuid(),
        qty: z.number().int().positive(),
        notes: z.string().nullable().default(null),
        sort_order: z.number().int().default(0),
      })
    )
    .optional(),
}).strict();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: tx, error: txError } = await supabase
    .from('transactions')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single();
  if (txError) {
    if (txError.code === NOT_FOUND_CODE) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ error: txError.message }, { status: 500 });
  }

  const { data: items, error: itemsError } = await supabase
    .from('transaction_items')
    .select('*')
    .eq('transaction_id', id)
    .order('sort_order');
  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  let scan_url: string | null = null;
  if (tx.scan_image_path) {
    const { data: signed } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(tx.scan_image_path, SIGNED_URL_TTL_SECONDS);
    scan_url = signed?.signedUrl ?? null;
  }

  return NextResponse.json({
    transaction: tx,
    items: items ?? [],
    scan_url,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 });
  }

  // Update header fields (status, customer_name, table_no)
  const headerUpdate: Record<string, unknown> = {};
  if (parsed.data.status !== undefined) {
    headerUpdate.status = parsed.data.status;
    if (parsed.data.status === 'confirmed') {
      headerUpdate.confirmed_at = new Date().toISOString();
    }
  }
  if (parsed.data.customer_name !== undefined) headerUpdate.customer_name = parsed.data.customer_name;
  if (parsed.data.table_no !== undefined) headerUpdate.table_no = parsed.data.table_no;

  if (Object.keys(headerUpdate).length > 0) {
    const { error: updateError } = await supabase
      .from('transactions')
      .update(headerUpdate)
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
      .single();
    if (updateError) {
      if (updateError.code === NOT_FOUND_CODE) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  // Replace items (if items provided)
  if (parsed.data.items !== undefined) {
    const { data: existingItems, error: existingError } = await supabase
      .from('transaction_items')
      .select('id, menu_id, unit_price_snapshot, qty, notes, sort_order')
      .eq('transaction_id', id);
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    const { data: menusData, error: menusError } = await supabase
      .from('menus')
      .select('id, name, price');
    if (menusError || !menusData) {
      return NextResponse.json({ error: 'menu_fetch_failed' }, { status: 500 });
    }

    let computed;
    try {
      computed = computeReplaceItems({
        existing: (existingItems ?? []) as ExistingItem[],
        requested: parsed.data.items,
        menus: menusData as MenuRef[],
      });
    } catch (err) {
      return NextResponse.json(
        { error: 'invalid_items', details: err instanceof Error ? err.message : 'unknown' },
        { status: 400 }
      );
    }

    // DELETE all existing + INSERT computed rows (atomic-ish — Supabase doesn't expose tx)
    const { error: deleteError } = await supabase
      .from('transaction_items')
      .delete()
      .eq('transaction_id', id);
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    if (computed.rows.length > 0) {
      const insertRows = computed.rows.map((r) => ({ ...r, transaction_id: id }));
      const { error: insertError } = await supabase
        .from('transaction_items')
        .insert(insertRows);
      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }
  }

  // Return fresh state
  const { data: finalTx } = await supabase
    .from('transactions')
    .select('*')
    .eq('id', id)
    .single();
  const { data: finalItems } = await supabase
    .from('transaction_items')
    .select('*')
    .eq('transaction_id', id)
    .order('sort_order');

  return NextResponse.json({ transaction: finalTx, items: finalItems ?? [] });
}
```

- [ ] **Step 7.2: Verify build + typecheck**

```bash
npx tsc --noEmit && npm run build
```

Expected: zero errors. Build output should list `ƒ /api/transactions/[id]`.

- [ ] **Step 7.3: Commit**

```bash
git add app/api/transactions/[id]/route.ts
git commit -m "feat(api): /api/transactions/[id] GET + PATCH with replace-items strategy"
```

---

## Task 8: `components/photo-uploader.tsx` — capture/file input + compress + POST

**Files:**
- Create: `components/photo-uploader.tsx`

- [ ] **Step 8.1: Implement `components/photo-uploader.tsx`**

```tsx
'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { compressNotaImage } from '@/lib/compress';
import { Button } from '@/components/ui/button';

type Stage = 'idle' | 'compressing' | 'uploading' | 'ocr' | 'error';

export function PhotoUploader() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('File harus berupa gambar (JPG/PNG).');
      setStage('error');
      return;
    }

    setError(null);
    setPreview(URL.createObjectURL(file));

    try {
      setStage('compressing');
      const compressed = await compressNotaImage(file);

      setStage('uploading');
      const formData = new FormData();
      formData.append('image', compressed);

      setStage('ocr');
      const res = await fetch('/api/scan', { method: 'POST', body: formData });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'scan-failed');
      }
      const json: { transaction_id: string } = await res.json();
      router.push(`/transactions/${json.transaction_id}/review`);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Gagal memproses foto: ${err.message}. Coba lagi.`
          : 'Gagal memproses foto. Coba lagi.'
      );
      setStage('error');
    }
  }

  function reset() {
    setStage('idle');
    setError(null);
    setPreview(null);
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const busy = stage === 'compressing' || stage === 'uploading' || stage === 'ocr';

  return (
    <div className="space-y-4">
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        className="hidden"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        className="hidden"
      />

      {preview && (
        <div className="surface-paper overflow-hidden rounded-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="" className="mx-auto max-h-96 object-contain" />
        </div>
      )}

      {!preview && (
        <div className="surface-paper rounded-2xl border-receipt p-12 text-center">
          <p className="font-display text-2xl italic text-coal">
            Siapkan nota
          </p>
          <p className="mt-2 text-sm text-coal-soft">
            Ambil foto langsung dari kamera, atau pilih dari galeri.
          </p>
        </div>
      )}

      {busy && (
        <div className="rounded-md bg-clay-mist px-4 py-3 text-sm text-coal-soft">
          {stage === 'compressing' && '📐 Mengompres foto…'}
          {stage === 'uploading' && '⬆️ Mengunggah ke server…'}
          {stage === 'ocr' && '✨ OCR sedang membaca nota… (5-15 detik)'}
        </div>
      )}

      {error && (
        <p
          className="rounded-md border border-brick/30 bg-brick-faint px-3 py-2 text-sm text-brick-dark"
          role="alert"
        >
          {error}
        </p>
      )}

      {!busy && !preview && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button
            size="lg"
            onClick={() => cameraInputRef.current?.click()}
            className="w-full"
          >
            📷 Buka Kamera
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            className="w-full"
          >
            🖼️ Pilih dari Galeri
          </Button>
        </div>
      )}

      {(stage === 'error' || (preview && !busy)) && (
        <Button variant="ghost" onClick={reset} className="w-full">
          Mulai ulang
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 8.2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 8.3: Commit**

```bash
git add components/photo-uploader.tsx
git commit -m "feat(scan): photo uploader with camera/gallery input + compress + upload"
```

---

## Task 9: `app/(app)/scan/page.tsx` — /scan page

**Files:**
- Create: `app/(app)/scan/page.tsx`

- [ ] **Step 9.1: Implement scan page**

```tsx
import { PhotoUploader } from '@/components/photo-uploader';

export default function ScanPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Scan Nota
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          Foto <span className="italic">nota</span> baru
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-coal-soft">
          OCR akan otomatis baca item dan total. Anda bisa edit hasilnya sebelum disimpan.
        </p>
      </div>

      <PhotoUploader />
    </div>
  );
}
```

- [ ] **Step 9.2: Manual verify**

```bash
npm run dev
```

Visit http://localhost:3000/scan (after login). Should see:
- Heading "Scan Nota / Foto nota baru"
- Empty paper card "Siapkan nota"
- Two buttons: "📷 Buka Kamera" and "🖼️ Pilih dari Galeri"

Pick a test photo (real Pak Pon nota from `/home/brondol/Downloads/WhatsApp Image 2026-06-20 at 14.04.48.jpeg`). Should see progressive stages: compressing → uploading → ocr → redirect to `/transactions/<uuid>/review`.

Review page won't exist yet (Task 12) — expect 404, that's fine for now.

Stop dev server.

- [ ] **Step 9.3: Commit**

```bash
git add "app/(app)/scan/page.tsx"
git commit -m "feat(scan): /scan page wiring PhotoUploader"
```

---

## Task 10: `components/nota-item-row.tsx` — one row in review list

**Files:**
- Create: `components/nota-item-row.tsx`

- [ ] **Step 10.1: Implement row component**

```tsx
'use client';

import { Button } from '@/components/ui/button';
import { formatRp } from '@/lib/currency';

export type NotaItem = {
  id?: string;            // present for existing items, absent for newly-added
  menu_id: string;
  menu_name_snapshot: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  sort_order: number;
  _localId: string;       // stable React key for unsaved items
};

export function NotaItemRow({
  item,
  onEdit,
  onDelete,
}: {
  item: NotaItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-4 px-5 py-3.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-coal truncate">{item.menu_name_snapshot}</span>
          <span className="text-xs text-clay">× {item.qty}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-clay">
          <span>
            {formatRp(item.unit_price_snapshot)} ea
          </span>
          {item.notes && (
            <>
              <span className="text-clay-soft">·</span>
              <span className="italic">{item.notes}</span>
            </>
          )}
        </div>
      </div>

      <div className="text-right">
        <div className="font-display text-base tracking-tight text-coal">
          {formatRp(item.unit_price_snapshot * item.qty)}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${item.menu_name_snapshot}`}>
          ✏️
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Hapus ${item.menu_name_snapshot}`}>
          🗑️
        </Button>
      </div>
    </li>
  );
}
```

- [ ] **Step 10.2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 10.3: Commit**

```bash
git add components/nota-item-row.tsx
git commit -m "feat(review): NotaItemRow component for review screen list"
```

---

## Task 11: `components/nota-item-modal.tsx` + `nota-review-form.tsx`

**Files:**
- Create: `components/nota-item-modal.tsx`
- Create: `components/nota-review-form.tsx`

- [ ] **Step 11.1: Implement modal**

Create `components/nota-item-modal.tsx`:

```tsx
'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatRp } from '@/lib/currency';
import type { NotaItem } from './nota-item-row';

export type MenuOption = {
  id: string;
  name: string;
  category: 'makanan' | 'nasi' | 'minuman';
  price: number;
};

export function NotaItemModal({
  initial,
  menus,
  onSave,
  onClose,
  onDelete,
}: {
  initial?: NotaItem;
  menus: MenuOption[];
  onSave: (item: NotaItem) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [menuId, setMenuId] = useState<string>(initial?.menu_id ?? menus[0]?.id ?? '');
  const [qty, setQty] = useState<number>(initial?.qty ?? 1);
  const [notes, setNotes] = useState<string>(initial?.notes ?? '');
  const [search, setSearch] = useState<string>('');

  const filteredMenus = useMemo(() => {
    const s = search.toLowerCase().trim();
    if (!s) return menus;
    return menus.filter((m) => m.name.toLowerCase().includes(s));
  }, [search, menus]);

  const selectedMenu = menus.find((m) => m.id === menuId);

  function handleSave() {
    if (!selectedMenu || qty < 1) return;
    onSave({
      id: initial?.id,
      _localId: initial?._localId ?? crypto.randomUUID(),
      menu_id: selectedMenu.id,
      menu_name_snapshot: initial?.menu_name_snapshot ?? selectedMenu.name,
      // Preserve snapshot price kalau edit existing item, otherwise pakai current menu price
      unit_price_snapshot: initial?.id ? initial.unit_price_snapshot : selectedMenu.price,
      qty,
      notes: notes.trim() === '' ? null : notes,
      sort_order: initial?.sort_order ?? 0,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-night-deep/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-paper-soft p-5 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-baseline justify-between">
          <h3 className="font-display text-xl italic text-coal">
            {initial?.id ? 'Edit item' : 'Tambah item'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="text-clay hover:text-coal"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="menu-search">Cari menu</Label>
            <Input
              id="menu-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="cth: pecel lele"
              className="mt-2"
            />
          </div>

          <div className="max-h-48 overflow-y-auto rounded-md border border-clay-soft">
            {filteredMenus.length === 0 && (
              <p className="px-3 py-4 text-center text-sm text-clay">Tidak ada menu cocok.</p>
            )}
            {filteredMenus.map((m) => {
              const active = m.id === menuId;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMenuId(m.id)}
                  className={[
                    'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors',
                    active ? 'bg-gold-faint text-coal' : 'hover:bg-cream',
                  ].join(' ')}
                >
                  <span>{m.name}</span>
                  <span className="text-clay">{formatRp(m.price)}</span>
                </button>
              );
            })}
          </div>

          <div>
            <Label htmlFor="qty">Jumlah</Label>
            <div className="mt-2 flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
              >
                −
              </Button>
              <Input
                id="qty"
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                className="w-20 text-center font-display"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setQty((q) => q + 1)}
              >
                +
              </Button>
              <span className="ml-auto font-display text-lg text-coal">
                {selectedMenu ? formatRp(selectedMenu.price * qty) : '—'}
              </span>
            </div>
          </div>

          <div>
            <Label htmlFor="notes">Catatan (opsional)</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="cth: D P, Dada, tanpa sambel"
              className="mt-2"
            />
          </div>

          <div className="flex gap-2 pt-2">
            {onDelete && initial?.id && (
              <Button type="button" variant="danger" onClick={onDelete}>
                🗑️ Hapus
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={onClose} className="ml-auto">
              Batal
            </Button>
            <Button type="button" onClick={handleSave} disabled={!selectedMenu || qty < 1}>
              Simpan
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 11.2: Implement review form orchestrator**

Create `components/nota-review-form.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatRp } from '@/lib/currency';
import { NotaItemRow, type NotaItem } from './nota-item-row';
import { NotaItemModal, type MenuOption } from './nota-item-modal';

type Transaction = {
  id: string;
  status: 'pending_review' | 'confirmed';
  handwritten_total: number | null;
  customer_name: string | null;
  table_no: string | null;
  created_at: string;
};

export function NotaReviewForm({
  transaction,
  initialItems,
  menus,
  scanUrl,
}: {
  transaction: Transaction;
  initialItems: Omit<NotaItem, '_localId'>[];
  menus: MenuOption[];
  scanUrl: string | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState<NotaItem[]>(
    initialItems.map((it) => ({ ...it, _localId: crypto.randomUUID() }))
  );
  const [editing, setEditing] = useState<NotaItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const computedSum = items.reduce(
    (acc, it) => acc + it.unit_price_snapshot * it.qty,
    0
  );
  const mismatch =
    !!transaction.handwritten_total &&
    transaction.handwritten_total !== computedSum;

  function upsertItem(item: NotaItem) {
    setItems((prev) => {
      const idx = prev.findIndex((p) => p._localId === item._localId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = item;
        return next;
      }
      // New item — append with next sort_order
      const nextSort = prev.length;
      return [...prev, { ...item, sort_order: nextSort }];
    });
    setEditing(null);
    setAdding(false);
  }

  function removeItem(localId: string) {
    setItems((prev) => prev.filter((p) => p._localId !== localId));
    setEditing(null);
  }

  async function handleConfirm() {
    setSubmitError(null);
    const payload = {
      status: 'confirmed' as const,
      items: items.map((it, idx) => ({
        id: it.id,
        menu_id: it.menu_id,
        qty: it.qty,
        notes: it.notes,
        sort_order: idx,
      })),
    };
    try {
      const res = await fetch(`/api/transactions/${transaction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'patch-failed');
      }
      startTransition(() => {
        router.push('/');
      });
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? `Gagal menyimpan: ${err.message}. Coba lagi.`
          : 'Gagal menyimpan. Coba lagi.'
      );
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Review Hasil OCR
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          Periksa <span className="italic">nota</span>
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-coal-soft">
          Pastikan item dan jumlah sudah benar. Klik ✏️ untuk edit, 🗑️ untuk hapus.
        </p>
      </div>

      {scanUrl && (
        <Card variant="paper" className="overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={scanUrl}
            alt="Foto nota"
            className="mx-auto max-h-72 w-full object-contain"
          />
        </Card>
      )}

      {mismatch && (
        <div
          className="rounded-md border border-mustard/40 bg-mustard-faint px-4 py-3 text-sm text-coal"
          role="alert"
        >
          ⚠️ Total tulisan tangan {formatRp(transaction.handwritten_total!)} berbeda
          dari perhitungan item {formatRp(computedSum)}. Selisih{' '}
          <strong>{formatRp(Math.abs(transaction.handwritten_total! - computedSum))}</strong>.
          Periksa lagi sebelum menyimpan.
        </div>
      )}

      <Card variant="paper">
        <ul className="divide-y divide-clay-soft/60">
          {items.length === 0 && (
            <li className="px-5 py-8 text-center text-sm text-clay">
              Belum ada item. Klik &quot;Tambah item&quot; di bawah.
            </li>
          )}
          {items.map((it) => (
            <NotaItemRow
              key={it._localId}
              item={it}
              onEdit={() => setEditing(it)}
              onDelete={() => removeItem(it._localId)}
            />
          ))}
        </ul>

        <div className="border-t border-clay-soft/60 px-5 py-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm uppercase tracking-wide text-clay">Total sistem</span>
            <span className="font-display text-2xl tracking-tight text-coal">
              {formatRp(computedSum)}
            </span>
          </div>
        </div>
      </Card>

      <Button variant="secondary" onClick={() => setAdding(true)} className="w-full">
        + Tambah item
      </Button>

      {submitError && (
        <p
          className="rounded-md border border-brick/30 bg-brick-faint px-3 py-2 text-sm text-brick-dark"
          role="alert"
        >
          {submitError}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          variant="secondary"
          onClick={() => router.push('/')}
          disabled={pending}
        >
          Batal
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={pending || items.length === 0}
          className="flex-1"
        >
          {pending ? 'Menyimpan…' : '✓ Konfirmasi'}
        </Button>
      </div>

      {(editing || adding) && (
        <NotaItemModal
          initial={editing ?? undefined}
          menus={menus}
          onSave={upsertItem}
          onClose={() => {
            setEditing(null);
            setAdding(false);
          }}
          onDelete={editing ? () => removeItem(editing._localId) : undefined}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 11.3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 11.4: Commit**

```bash
git add components/nota-item-modal.tsx components/nota-review-form.tsx
git commit -m "feat(review): item modal + review form orchestrator with mismatch warning"
```

---

## Task 12: `app/(app)/transactions/[id]/review/page.tsx`

**Files:**
- Create: `app/(app)/transactions/[id]/review/page.tsx`

- [ ] **Step 12.1: Implement page (server component)**

```tsx
import { notFound } from 'next/navigation';
import { getSupabaseServer } from '@/lib/supabase/server';
import { NotaReviewForm } from '@/components/nota-review-form';
import type { MenuOption } from '@/components/nota-item-modal';

export const dynamic = 'force-dynamic';

const STORAGE_BUCKET = 'notas';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await getSupabaseServer();

  const { data: tx, error: txError } = await supabase
    .from('transactions')
    .select('id, status, handwritten_total, customer_name, table_no, created_at, scan_image_path')
    .eq('id', id)
    .is('deleted_at', null)
    .single();
  if (txError || !tx) notFound();

  const { data: items } = await supabase
    .from('transaction_items')
    .select('id, menu_id, menu_name_snapshot, unit_price_snapshot, qty, notes, sort_order')
    .eq('transaction_id', id)
    .order('sort_order');

  const { data: menusData } = await supabase
    .from('menus')
    .select('id, name, category, price')
    .eq('is_active', true)
    .order('category')
    .order('name');
  const menus: MenuOption[] = menusData ?? [];

  let scanUrl: string | null = null;
  if (tx.scan_image_path) {
    const { data: signed } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(tx.scan_image_path, SIGNED_URL_TTL_SECONDS);
    scanUrl = signed?.signedUrl ?? null;
  }

  return (
    <NotaReviewForm
      transaction={{
        id: tx.id,
        status: tx.status,
        handwritten_total: tx.handwritten_total,
        customer_name: tx.customer_name,
        table_no: tx.table_no,
        created_at: tx.created_at,
      }}
      initialItems={items ?? []}
      menus={menus}
      scanUrl={scanUrl}
    />
  );
}
```

- [ ] **Step 12.2: Verify build**

```bash
npx tsc --noEmit && npm run build
```

Expected: zero errors. Build output should list `ƒ /transactions/[id]/review`.

- [ ] **Step 12.3: End-to-end manual test**

```bash
npm run dev
```

Visit http://localhost:3000 → login → klik tile "Scan Nota" → upload foto nota Pak Pon (gunakan `/home/brondol/Downloads/WhatsApp Image 2026-06-20 at 14.04.48.jpeg`).

Expected:
1. Compressing → uploading → "OCR sedang membaca…" (~5-15 dtk)
2. Auto-redirect ke `/transactions/<uuid>/review`
3. Foto thumbnail muncul
4. List items dengan: Pecel Lele×3, Ayam Goreng×2 (notes: "D P"), Bebek Goreng×1 (notes: "Dada"), Sop Ayam×1, Nasi×6, Tahu Tempe×2, Kol Goreng×2
5. Total system di footer
6. Warning kuning kalau handwritten total (222.000) ≠ computed sum

Test interactions:
- Klik ✏️ di salah satu item → modal muncul dengan menu picker, qty stepper, notes field
- Edit qty → close → total update
- Klik 🗑️ → item hilang → total update
- Klik "+ Tambah item" → modal kosong → cari menu di search → pilih → set qty → save → muncul di list
- Klik "Batal" → kembali ke home tanpa simpan
- Klik "✓ Konfirmasi" → PATCH ke API → redirect ke `/`

Verify di Supabase dashboard:
- Tabel `transactions` row dengan id sesuai, status=`confirmed`, confirmed_at terisi
- Tabel `transaction_items` rows sesuai final list
- Storage bucket `notas/<yyyy-mm>/<uuid>.jpg` ada

Stop dev server.

- [ ] **Step 12.4: Commit**

```bash
git add "app/(app)/transactions/[id]/review/page.tsx"
git commit -m "feat(review): /transactions/[id]/review server component fetches + delegates"
```

---

## Task 13: Update `docs/tasks.md` + push

**Files:**
- Modify: `docs/tasks.md`

- [ ] **Step 13.1: Mark Plan 2 complete**

Replace Plan 2 section in `docs/tasks.md`:

```markdown
## Plan 2 — Scan + OCR + Review + Save ✅ COMPLETE
- [x] T1 Install deps (@google/genai, browser-image-compression) + vercel.json
- [x] T2 lib/compress.ts client-side compression
- [x] T3 lib/prompts.ts OCR prompt + Zod schema (TDD)
- [x] T4 lib/gemini.ts SDK wrapper with Flash → Pro fallback
- [x] T5 /api/scan POST handler
- [x] T6 lib/transactions.ts replace-items diff helper (TDD)
- [x] T7 /api/transactions/[id] GET + PATCH
- [x] T8 components/photo-uploader.tsx
- [x] T9 /scan page
- [x] T10 components/nota-item-row.tsx
- [x] T11 nota-item-modal + nota-review-form
- [x] T12 /transactions/[id]/review server component

End-to-end: foto nota → OCR Gemini → review editable → simpan ke DB + storage.
```

- [ ] **Step 13.2: Commit + push**

```bash
git add docs/tasks.md
git commit -m "docs: mark Plan 2 complete"
git push origin master
```

---

## Acceptance criteria — Plan 2 complete

- [ ] `npm run test` passes (all currency + prompts + transactions tests green)
- [ ] `npm run build` passes
- [ ] `npx tsc --noEmit` zero errors
- [ ] `/scan` UI loads, camera and file picker both work
- [ ] Real Pak Pon nota foto processed by Gemini → items extracted with correct menu_name + qty + notes
- [ ] Review page shows thumbnail + editable item list + mismatch warning when relevant
- [ ] Edit modal: menu search works, qty stepper works, notes preserved
- [ ] Add item modal works (no `initial`)
- [ ] Delete item removes from list, total updates
- [ ] Confirm → PATCH succeeds → transaction status=confirmed, items in DB match UI, redirect to /
- [ ] Storage object exists at `notas/<yyyy-mm>/<uuid>.jpg`
- [ ] Cancel → no DB writes after the initial scan draft
- [ ] When OCR returns empty (try a non-nota image like landscape photo), draft is still created with items=[], kasir can input manually
- [ ] GEMINI_API_KEY set in Vercel env (production deploy works)

After all checked: Plan 2 done, ready for Plan 3 (History + Reports + Cron).
