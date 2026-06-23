# AI Scan Improvements — Design Spec

**Date:** 2026-06-23
**Status:** Approved (brainstorming phase complete, ready for implementation plan)
**Scope:** Tuning AI OCR scan untuk mengurangi friction kasir saat review nota — confidence highlighting, top-N alternatives untuk swap cepat, hint satuan ribuan, smart total parser, notes raw text hint.

## 1. Latar belakang

Saat ini scan nota pakai Gemini 2.5 Flash (fallback Pro) dengan structured output Zod. Schema enforce `menu_name` ke enum master menu — jadi gak ada hallucinated menu. Tapi dua kelas masalah masih sering muncul saat review:

1. **Wrong menu pick.** AI confuse antara menu yang mirip (cth: "Bebek Goreng" vs "Ayam Goreng"). Saat sum cocok, kasir gak sadar. Saat sum tidak cocok, kasir harus pelototin tiap item buat cari yang salah.
2. **Wrong total interpretation.** Kasir biasa nulis total ringkas: "92" untuk Rp 92.000. AI sering baca literal "92" → trigger mismatch warning yang sebenernya false positive.

Tujuan spec ini: kurangi review friction dengan kasih kasir signal visual yang langsung point ke item bermasalah, plus mekanisme one-click correction.

## 2. Goal & non-goal

**Goal (v1, bundle 1 PR):**
- AI return per-item confidence (0–100) → review UI highlight kuning/merah berdasarkan tier
- AI return top-2 menu alternatives → tampil sebagai chip swap di item low-confidence
- Prompt explicit hint: handwritten_total satuan ribuan
- Backend safety net: detect mismatch sat. ribuan, warning + suggest fix banner di UI
- Prompt hint: notes raw text (jangan kosongin kalau ga yakin)

**Non-goal (defer):**
- Crop region per item (bounding boxes) — Gemini akurasi handwriting iffy
- Self-verify dalam OCR pass (LLM jelek aritmatika, redundant dgn computed_sum client-side)
- Few-shot from past corrections — butuh tabel & pipeline baru, baru kerasa setelah data terkumpul (v2 material)
- Calibrasi confidence terhadap akurasi aktual (LLM self-rated, gunakan sebagai signal relatif saja)
- Per-field confidence (menu_name vs qty vs notes split) — overhead tidak sebanding

## 3. Design decisions

| Decision | Pilihan | Reasoning |
|---|---|---|
| Confidence granularity | Satu angka overall per item | Schema simple, UI simple, threshold simple. Visual nota biasanya jelas qty — kalau low, hampir pasti masalah di menu_name. |
| Threshold | 2 tier: <90 kuning, <75 merah | LLM cenderung overconfident, jadi 75 cukup ketat untuk merah. Banyak item masuk kuning supaya kasir tetap notice; merah jadi standout urgency. |
| Alternatives | Top 2, hanya saat low conf (<90) | Minimal visual noise. Top 3 sering ngaco di slot ke-3. |
| Smart total fix | Warning + suggest banner di UI | Aman, gak silent change. Kasir keputusan. |
| Delivery | Bundle 5 fitur dalam 1 plan | Scope kecil, features tightly coupled (alternatives UI butuh confidence schema). |
| Confidence storage | Persist di DB (nullable) | Berguna untuk analytics nanti. NULL = item ditambah/diedit manual (bukan dari AI). |
| Alternatives storage | Persist di DB (jsonb, nullable) | Dibutuhkan saat review (server-rendered page). Aman dibiarin setelah confirm — gak ada cleanup. |
| Color tokens | `mustard-faint` (kuning), `brick-faint` (merah) | Sudah ada di design system, konsisten dengan mismatch banner & error states existing. |

## 4. Schema changes

### 4.1 Prompt (`lib/prompts.ts`)

Tambah 4 instruksi baru ke `OCR_SYSTEM_PROMPT`:

```
5. Untuk SETIAP item, kasih `confidence` (0–100): seberapa yakin Anda bahwa
   menu_name + qty + notes terbaca dengan benar. Pertimbangkan kejelasan
   tulisan tangan, ambiguitas vs menu lain, dan kemiripan visual.
6. Untuk SETIAP item, kasih `alternatives` (array, maksimal 2): menu-menu
   lain dari daftar master yang punya kemungkinan benar (urutkan dari paling
   mungkin). Kosongkan kalau Anda sangat yakin (confidence ≥ 90).
7. PENTING: handwritten_total ditulis dalam SATUAN RIBUAN RUPIAH.
   Kalau kasir tulis "92", baca sebagai 92000. Kalau "92.000" atau "92rb",
   juga 92000. Selalu return dalam rupiah penuh.
8. Untuk notes, kalau ada tulisan tangan di sebelah menu tapi maknanya
   tidak jelas, tetap masukkan tulisan mentahnya — jangan kosongkan.
```

### 4.2 Zod schema (`buildScanSchema` di `lib/prompts.ts`)

```ts
items: z.array(z.object({
  menu_name: menuNameSchema,
  qty: z.number().int().positive(),
  notes: z.string().nullable(),
  confidence: z.number().int().min(0).max(100),       // NEW
  alternatives: z.array(z.object({                     // NEW
    menu_name: menuNameSchema,
    confidence: z.number().int().min(0).max(100),
  })).max(2),
}))
```

`handwritten_total`, `customer_name`, `table_no` tidak berubah.

### 4.3 DB migration `supabase/migrations/0007_scan_confidence.sql`

```sql
ALTER TABLE transaction_items
  ADD COLUMN confidence smallint CHECK (confidence BETWEEN 0 AND 100),
  ADD COLUMN alternatives jsonb;
-- confidence NULL = item ditambah atau diedit manual oleh kasir (bukan dari AI)
-- alternatives shape: [{ "menu_name": "...", "confidence": 62 }, ...]
```

Tidak ada index baru — confidence belum dipakai untuk query.

## 5. Backend

### 5.1 `lib/total-parser.ts` (new + test)

```ts
export type ThousandsHint =
  | { suggest: false }
  | { suggest: true; suggested_total: number };

/**
 * Detect kemungkinan handwritten_total ditulis ringkas (tanpa ribuan).
 * Trigger: handwritten_total < 1000 AND (handwritten_total * 1000)
 *          dalam ±15% dari computed_sum.
 */
export function detectThousandsMissing(
  handwritten_total: number | null,
  computed_sum: number
): ThousandsHint;
```

Logic:
- Return `{ suggest: false }` kalau `handwritten_total` null/0 atau `computed_sum` 0
- Return `{ suggest: false }` kalau `handwritten_total >= 1000`
- `expanded = handwritten_total * 1000`
- Return `{ suggest: true, suggested_total: expanded }` kalau `|expanded - computed_sum| / computed_sum <= 0.15`
- Else `{ suggest: false }`

Test cases minimum: nilai null, nilai 0, nilai 92 dengan sum 90000 (suggest), nilai 92 dengan sum 5000 (no suggest — di luar tolerance), nilai 92000 (skip — sudah masuk akal), nilai 1500 (skip — >= 1000).

### 5.2 `app/api/scan/route.ts`

Perubahan minimal:
1. Saat insert ke `transaction_items`, sertakan `confidence: item.confidence` dan `alternatives: item.alternatives` (jsonb).
2. Setelah hitung `computedSum`, panggil `detectThousandsMissing(ocr.handwritten_total, computedSum)`.
3. Response body tambah `suggest_thousands` field (full hint object).
4. Wide-event log tambah:
   - `ocr_conf_min` (number)
   - `ocr_conf_mean` (number)
   - `ocr_low_conf_count` (count item dengan confidence < 75)
   - `suggest_thousands` (bool)

### 5.3 `app/api/transactions/[id]/route.ts` — extend PATCH

Tambah ke `PatchSchema`:
```ts
handwritten_total: z.number().int().nonnegative().nullable().optional(),
```

Di item-level PatchSchema (untuk `replaceItems`), tambah:
```ts
confidence: z.number().int().min(0).max(100).nullable().optional(),
alternatives: z.array(z.object({
  menu_name: z.string(),
  confidence: z.number().int().min(0).max(100),
})).optional(),
```

`replaceItems` saat re-insert: include `confidence` + `alternatives` apa adanya dari payload. Kalau kasir swap menu atau edit via modal, client kirim `confidence: null` supaya highlight hilang.

`applyHeaderUpdate` saat handwritten_total di-set: update field di transactions. Wide-event log: `total_changed: true` (fakta saja, tanpa attribusi ke smart-total flow — keep it simple).

## 6. UI

### 6.1 `components/nota-item-row.tsx`

Props baru:
- `confidence: number | null`
- `alternatives: { menu_name: string; confidence: number }[]`
- `menusByName: Map<string, MenuOption>`
- `onSwapMenu: (localId: string, newMenu: MenuOption) => void`

Tier helper:
```ts
const tier =
  confidence === null ? null :
  confidence < 75 ? 'red' :
  confidence < 90 ? 'yellow' : null;
```

Class mapping (pakai design tokens, no hardcoded color):
- `tier === 'red'` → `bg-brick-faint border-l-4 border-brick`
- `tier === 'yellow'` → `bg-mustard-faint border-l-4 border-mustard`
- else → no tint, no border

Render struktur (semua dalam `<li>`):
```
┌─ row (tinted bg + left border kalau tier) ─────────────┐
│  Bebek Goreng × 1            Rp 25.000   ✏️ 🗑️        │
│  Rp 25.000 ea                                            │
│                                                          │
│  ⚠ 62%  Mungkin:  [Ayam Goreng]  [Lele Goreng]          │  ← kalau tier && alts.length > 0
└──────────────────────────────────────────────────────────┘
```

Chip alternative:
- Button kecil, style ghost-outline, padding ringan, text-xs
- Label: nama menu (truncate kalau panjang)
- `aria-label="Ganti ke {menu_name}"`
- onClick: lookup `menusByName.get(alt.menu_name)` → call `onSwapMenu(item._localId, newMenu)`
- Skip render chip kalau menu sudah tidak aktif (`menusByName.get` return undefined)

Badge `⚠ {confidence}%`: text-xs, color match tier.

### 6.2 `components/nota-review-form.tsx`

Perubahan:
1. `NotaItem` type include `confidence: number | null`, `alternatives: { menu_name; confidence }[]`.
2. Bangun `menusByName: Map<string, MenuOption>` dari prop `menus` (useMemo).
3. New `handleSwap(localId, newMenu)`:
   - Update item di state: `menu_id`, `menu_name_snapshot`, `unit_price_snapshot` ← dari newMenu; `confidence` ← null; `alternatives` ← [].
   - Toast info: "Diganti ke {newMenu.name}".
4. Pass `menusByName`, `handleSwap` ke setiap `NotaItemRow`.
5. Saat user edit via modal (existing `upsertItem`): set `confidence` ke null + `alternatives` ke [].
6. **Smart total banner** (baru, di atas mismatch banner existing):

```tsx
{suggestThousands.suggest && !thousandsDismissed && (
  <div className="rounded-md border border-mustard/40 bg-mustard-faint px-4 py-3 text-sm text-coal">
    💡 Total tertulis <strong>{formatRp(transaction.handwritten_total)}</strong>.
       Mungkin maksudnya <strong>{formatRp(suggestThousands.suggested_total)}</strong>?
    <div className="mt-2 flex gap-2">
      <Button size="sm" onClick={handleApplyThousands}>
        Pakai {formatRp(suggestThousands.suggested_total)}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setThousandsDismissed(true)}>
        Tetap {formatRp(transaction.handwritten_total)}
      </Button>
    </div>
  </div>
)}
```

`handleApplyThousands`:
- PATCH `/api/transactions/[id]` dengan `{ handwritten_total: suggestThousands.suggested_total }`
- Update local state `transaction.handwritten_total`
- Dismiss banner
- Toast success

7. `handleConfirm` payload `items`: include `confidence` dan `alternatives` apa adanya dari state.

### 6.3 `app/(app)/transactions/[id]/review/page.tsx`

- Select tambahan: `confidence, alternatives` dari `transaction_items`.
- Setelah fetch, compute `computedSum`, panggil `detectThousandsMissing(tx.handwritten_total, computedSum)`.
- Pass `suggestThousands` ke `<NotaReviewForm>`.

## 7. Data flow

```
Foto nota
   │
   ▼
POST /api/scan
   │  Gemini call (prompt + menu master + image)
   │  → items[{menu_name, qty, notes, confidence, alternatives}]
   │  → handwritten_total
   │  Insert transactions + transaction_items (with conf + alts)
   │  detectThousandsMissing(handwritten_total, computed_sum)
   ▼
Response: { transaction_id, suggest_thousands, ... }
   │
   ▼  redirect ke /transactions/[id]/review
   │
Server load review page
   │  Re-fetch tx + items (with conf + alts) dari DB
   │  Re-compute suggestThousands
   ▼
<NotaReviewForm>
   │  Smart-total banner (kalau suggest_thousands)
   │  Mismatch banner (kalau handwritten_total !== computed_sum)
   │  <NotaItemRow> per item:
   │     - tier tint kalau confidence < 90
   │     - alt chips kalau tier non-null & alts.length > 0
   │     - klik chip → handleSwap → state update (conf=null)
   │     - klik ✏️ → modal → upsertItem (conf=null)
   ▼
Confirm → PATCH /api/transactions/[id]
   │  status=confirmed, items dengan conf + alts (apa adanya)
   ▼
Print queue + redirect ke home
```

## 8. Error handling & edge cases

- **AI return invalid confidence** (e.g., 150, -1, missing): Zod schema reject → fallback ke Pro model (existing behavior).
- **AI return alternatif yang sama dengan menu_name primary**: filter di client-side rendering (skip chip kalau `alt.menu_name === item.menu_name_snapshot`).
- **AI return alternatif menu yang sudah tidak aktif**: enum schema sudah filter ke `is_active=true` menus saat scan, jadi seharusnya safe. Client tetap defensive: skip chip kalau `menusByName.get(alt.menu_name)` return undefined.
- **Kasir tambah item manual** (klik + Tambah item): confidence=null, alternatives=[] → no highlight. Correct behavior.
- **Kasir edit item via modal**: upsertItem set confidence=null + alternatives=[]. Correct.
- **Kasir swap pakai chip**: handleSwap update menu_id + price + name + confidence=null + alternatives=[]. Correct.
- **Total = 0 / null**: smart-total parser skip. Banner gak muncul.
- **Computed_sum = 0** (items kosong): smart-total parser skip.
- **Kasir klik "Tetap Rp 92"**: dismiss banner. Mismatch banner existing tetap muncul (karena handwritten=92, computed=92000 → mismatch). Itu correct — user mau accept inconsistency.
- **Refresh page setelah klik "Pakai"**: handwritten_total sudah ke-update di DB, server-load fresh data → banner gak muncul lagi (suggestThousands.suggest=false karena handwritten_total udah ≥ 1000).

## 9. Observability (wide-event additions)

`POST /api/scan`:
- `ocr_conf_min` (number, min confidence di items)
- `ocr_conf_mean` (number, average confidence)
- `ocr_low_conf_count` (count items dengan confidence < 75)
- `ocr_low_conf_items` (string[], menu_name dari item low conf — buat investigasi pattern)
- `suggest_thousands` (bool)

`PATCH /api/transactions/[id]`:
- `total_changed` (bool — kalau handwritten_total ke-update)
- `items_swapped_count` (kalau bisa di-derive — opsional, skip kalau ribet)

## 10. Testing

**Unit tests:**
- `lib/total-parser.test.ts`: 6 cases (null, 0, undersize match, undersize no-match, oversize, edge tolerance).
- `lib/prompts.test.ts`: update existing test — verifikasi schema baru parse OK, reject confidence out of range, reject >2 alternatives.

**Component tests (optional, kalau sudah ada pattern di repo):**
- `nota-item-row.test.tsx`: render tier tints, click chip calls onSwapMenu, skip chip kalau menu tidak ada di map.

**Manual QA:**
- Scan nota real, verify highlight muncul di item yang AI memang ragu.
- Scan nota dengan total ringkas (cth: "85"), verify smart-total banner muncul, klik "Pakai" persist.
- Swap menu via chip, verify highlight hilang + price recalculated + computed_sum update.
- Confirm transaksi, verify confidence + alternatives ke-save (cek DB).

## 11. Migration & rollout

1. Apply migration `0007_scan_confidence.sql` — additive, no data loss, safe.
2. Old `transaction_items` rows: `confidence=NULL`, `alternatives=NULL` → no highlight (correct, treated as user-managed).
3. Deploy backend + frontend simultaneously (schema change requires both).
4. First scan setelah deploy akan return enriched schema. Monitor wide-event metrics 1 hari untuk validasi confidence quality.

## 12. Open questions (tidak blocking)

- **Threshold tuning:** apakah 90/75 cocok in practice? Setelah seminggu produksi, review distribusi confidence vs correction rate. Adjust kalau perlu.
- **Reset confidence saat swap:** apakah kasir mau bukti audit "AI awalnya pilih X dengan 62%"? Saat ini tidak — confidence di-null-kan. Bisa ditambah `confidence_original` column kalau diperlukan untuk analytics.
- **Suggest thousands threshold (1000 cutoff & 15% tolerance):** angka kasar berdasarkan reasoning. Kalau false positive/negative banyak setelah seminggu, tuning.
