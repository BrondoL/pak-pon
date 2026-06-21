# Menu Note Presets (Plan A of POS feature) — Design Spec

**Date:** 2026-06-21
**Status:** Approved (brainstorming phase complete, pending implementation plan)
**Relates:** Q3 decision di `2026-06-20-pak-pon-design.md` (notes free-text only, no variant). Spec ini **revise** keputusan tersebut — notes sekarang punya struktur chip preset + optional add-on price.

**Sub-project of:** "POS direct order" backlog item. Plan A (this spec) handles master menu extension. Plan B (POS direct order page) menyusul setelah Plan A landed.

## 1. Latar belakang

Owner warung pakai Luna POS sekarang. Kasir capek saat ramai karena harus ngetik manual notes seperti "dada paha jangan terlalu garing" — lambat, salah ketik, pelanggan complain. Solusi: chip preset di master menu, kasir tinggal tap chip. Plus optional add-on price untuk variant yang harganya beda (mis. "Paha atas +3rb").

Plan A scope: extend data model + master menu UI untuk kelola chip. Consumer langsung: `nota-item-modal` di flow `/transactions/[id]/review` (OCR review). Plan B (POS halaman baru) pakai chip yang sama.

## 2. Tujuan

- Owner bisa setup chip preset per menu (mutex group untuk pilihan eksklusif, additive untuk catatan dapur, plus add-on price opsional)
- Kasir di review modal tap chip alih-alih ketik
- Support real case "qty 2 ayam, 1 dada 1 paha" via auto-split ke multiple transaction_items rows
- Backward compatible — existing menus default `note_presets = []`, existing transaction_items default `note_presets_snapshot = []`
- Zero math regression saat tidak ada chip
- Reports tetap accurate (chip add-on revenue masuk total)

## 3. Non-goals

- POS direct order page (Plan B)
- OCR Gemini extract chip langsung (MVP: kasir manual convert dari free-text saat review)
- Chip image / icon
- Translate / multi-bahasa
- Chip dengan stock limit
- Chip dengan discount/negative price_delta
- Per-porsi free-text "catatan lain" berbeda (single textarea applies to whole line)
- Merge UI di transaction detail/review saat ada 2 rows same menu different chips (data view, not merged view)
- Bulk template "copy chip dari menu lain" (skip MVP, future enhancement)

## 4. Data model

### 4.1. `menus.note_presets` (kolom baru, JSONB)

```sql
ALTER TABLE menus ADD COLUMN note_presets jsonb NOT NULL DEFAULT '[]'::jsonb;
```

Element shape:

```ts
type NotePreset = {
  id: string;          // stable identifier; ULID atau UUID short, max 32 char
  label: string;       // "Dada", "Extra sambel", "Jangan garing"; 1-40 char
  price_delta: number; // rupiah integer ≥ 0; bigint juga OK
  mutex_group: string | null;  // nullable. Same group = mutually exclusive; max 20 char
  sort_order: number;  // tampilan urutan; integer ≥ 0
};
```

Contoh untuk Ayam Goreng:

```json
[
  {"id":"01","label":"Dada",        "price_delta":0,   "mutex_group":"bagian","sort_order":0},
  {"id":"02","label":"Paha",        "price_delta":0,   "mutex_group":"bagian","sort_order":1},
  {"id":"03","label":"Paha atas",   "price_delta":3000,"mutex_group":"bagian","sort_order":2},
  {"id":"04","label":"Extra sambel","price_delta":2000,"mutex_group":null,    "sort_order":10},
  {"id":"05","label":"Tanpa kulit", "price_delta":0,   "mutex_group":null,    "sort_order":11},
  {"id":"06","label":"Jangan garing","price_delta":0,  "mutex_group":null,    "sort_order":12}
]
```

Cap di Zod: max 20 chip per menu untuk sanity.

### 4.2. `transaction_items.note_presets_snapshot` (kolom baru, JSONB)

```sql
ALTER TABLE transaction_items
  ADD COLUMN note_presets_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;
```

Element shape (subset of NotePreset — snapshot tidak butuh `sort_order` atau `mutex_group`):

```ts
type NotePresetSnapshot = {
  id: string;        // refer ke source NotePreset.id (untuk audit)
  label: string;     // copy saat tx dibuat (preserve kalau master diubah)
  price_delta: number;
};
```

### 4.3. Math

Per `transaction_items` row:

```
line_total = (unit_price_snapshot + Σ note_presets_snapshot[*].price_delta) × qty
```

`unit_price_snapshot` tetap base price menu saat tx dibuat (semantik existing tidak berubah).

### 4.4. Existing fields tidak berubah

- `transaction_items.notes` (text nullable) → free-text "catatan lain" (1 field per line, semua porsi)
- `transaction_items.unit_price_snapshot` (bigint) → base price saja
- `transaction_items.qty` (int) → quantity (kalau >1 dengan mutex_group beda per porsi → split jadi multiple rows)
- `transaction_items.menu_id`, `menu_name_snapshot` → tetap

### 4.5. Backward compatibility

- Migration default `'[]'::jsonb` → existing menus & transaction_items dapat array kosong
- Math untuk row dengan empty snapshot: `Σ = 0` → `line_total = base × qty` → identical dengan sebelumnya
- Zero regression untuk transaksi historis

### 4.6. Reports impact

- `/api/reports/daily` dan `/monthly`: line_total reduce function harus include `note_presets_snapshot` sum. Update di route handler + server pages yang aggregate.
- Top items aggregation: group by `menu_name_snapshot` (tidak ubah). Revenue per item = `Σ line_totals` (include add-ons).

## 5. API changes

### 5.1. `GET /api/menus`

Response items extended:

```ts
{
  items: Array<{
    id, name, category, price, sort_order, is_active,
    note_presets: NotePreset[]   // NEW, default []
  }>
}
```

Existing consumers (`/menu` UI, OCR Gemini context) yang tidak baca field tambahan tidak break.

### 5.2. `POST /api/menus` & `PATCH /api/menus/[id]`

Body extended dengan `note_presets` (opsional). Replace-semantics: kalau dikirim, replace seluruh array di master.

Zod schema:

```ts
const NotePresetSchema = z.object({
  id: z.string().min(1).max(32),
  label: z.string().min(1).max(40),
  price_delta: z.number().int().min(0),
  mutex_group: z.string().max(20).nullable().optional().default(null),
  sort_order: z.number().int().min(0).default(0),
});

const MenuCreateSchema = z.object({
  // existing fields...
  note_presets: z.array(NotePresetSchema).max(20).optional().default([]),
});

const MenuPatchSchema = MenuCreateSchema.partial();
```

Server-side: jangan ada 2 chip dengan id duplikat (validasi). Label duplikat tidak diblokir (cuma warn di UI, server permissive).

### 5.3. `PATCH /api/transactions/[id]`

Items extended:

```ts
items: Array<{
  id?: string,
  menu_id: string,
  qty: number,
  notes?: string | null,
  note_presets_snapshot?: NotePresetSnapshot[]  // NEW, default []
}>
```

Server-side validation per item:
- `note_presets_snapshot[*].id` boleh ada di master saat ini atau tidak (snapshot self-sufficient — kalau master chip dihapus, snapshot tetap valid)
- Tidak ada 2 entry dengan `id` duplikat dalam satu item
- Cross-check mutex: kalau ada 2 entry yang mengacu ke master chip dengan `mutex_group` sama, server reject 400 `invalid_body`. Server perlu lookup `menus.note_presets` by id untuk validate. Implementation: select master menu sekali, build id→mutex_group map, scan snapshot entries.

(Note: kalau master chip sudah dihapus / mutex_group sudah diubah setelah tx dibuat, validation skip cross-check untuk id yang tidak ada di master sekarang. Snapshot saja dipakai.)

### 5.4. `GET /api/transactions/[id]`

Response item extended dengan `note_presets_snapshot` di setiap line. Consumer page handle field baru.

### 5.5. `POST /api/scan`

No change. OCR Gemini tetap extract `notes` free-text default. Server tidak set `note_presets_snapshot` (default `[]`).

### 5.6. `GET /api/reports/daily` & `/monthly`

Math di handler harus include `note_presets_snapshot` sum saat hitung `line_total`. No response shape change.

## 6. Master menu UI

### 6.1. MenuForm extension

Di Dialog edit menu (existing — `/menu` page, klik Edit pada baris menu), tambah section "Catatan & pilihan" di bawah field harga + sort_order.

Layout (per Section 3 brainstorming):

```
── Catatan & pilihan (opsional) ──
Group    Label           Harga+   Aksi
bagian   Dada            +0       [⋯][🗑]
bagian   Paha            +0       [⋯][🗑]
bagian   Paha atas       +3.000   [⋯][🗑]
—        Extra sambel    +2.000   [⋯][🗑]
—        Jangan garing   +0       [⋯][🗑]
[+ Tambah catatan]
```

### 6.2. Komponen baru: `components/note-preset-editor.tsx`

Standalone client component, props:
- `value: NotePreset[]`
- `onChange: (next: NotePreset[]) => void`
- `existingGroups: string[]` — list mutex_group strings yang sudah dipakai di menu lain, untuk datalist suggestion

Interactions:
- Inline edit label (click → input)
- Group cell: combobox bebas dengan datalist suggest. Empty selection = mutex_group=null (additive)
- Harga cell: inline number input, default 0
- `[⋯]` drag handle untuk reorder (update `sort_order`)
- `[🗑]` dengan inline confirm
- `[+ Tambah catatan]`: append row baru dengan default {id: nanoid(8), label: '', price_delta: 0, mutex_group: null, sort_order: max+1}

### 6.3. Validation client-side

Sebelum kirim PATCH:
- Label non-empty, length ≤ 40
- price_delta integer ≥ 0
- mutex_group string ≤ 20 char (atau null)
- Tidak ada 2 row dengan label identik dalam menu sama (warn, tidak blocking)
- Tidak ada row dengan label kosong (blocking, prevent submit + highlight row)

### 6.4. Empty state

Kalau menu belum punya preset:

> *"Belum ada chip. Tambahkan kalau menu ini sering punya request seperti 'dada/paha' atau 'tanpa sambel'. Tanpa chip pun OK — kasir bisa ketik bebas di catatan."*

### 6.5. Live preview

Di kanan editor (desktop) atau di bawah (mobile), mock-up chip render seperti yang akan tampil di nota-item-modal. Update real-time saat kasir edit. Optional MVP — bisa defer kalau too much scope.

## 7. Consumer: nota-item-modal extension

### 7.1. Section "Pilihan untuk {menu name}"

Di modal `/transactions/[id]/review` saat add/edit item, **muncul** di antara qty stepper dan free-text catatan **kalau** menu yang dipilih punya `note_presets.length > 0`.

Kalau kosong → section sembunyi (modal jadi seperti sekarang).

### 7.2. Render groups

- Group chip dengan `mutex_group` sama → radio chips
- Chip dengan `mutex_group = null` → checkbox chips
- Label chip include `+price_delta` kalau >0 (format "rb" compact, e.g. "Paha atas +3rb")

### 7.3. Per-porsi cards

- Muncul **kalau** qty > 1 **dan** ada minimal 1 chip dengan mutex_group
- N cards "Porsi 1 of N", "Porsi 2 of N", dst
- Setiap porsi: full chip groups (mutex pick + additive pick)
- Default porsi 2..N: copy chip dari porsi 1 (best-effort initial state)
- Kalau qty=1 atau semua chip additive → tampil 1 card "Pilihan" tanpa label "Porsi"

### 7.4. Shortcut "Samakan semua porsi"

Kalau qty > 1 dan per-porsi cards aktif → tombol di bawah cards: `↻ Samakan semua porsi dengan #1`. Tap → copy porsi 1's selection ke porsi 2..N.

### 7.5. Free-text "Catatan lain"

Existing textarea tetap, satu field per line (semua porsi). Untuk request unik yang tidak ada chip.

### 7.6. Total live preview

Footer modal tampil `Total: Rp X` real-time:

```
total = Σ porsi (base + Σ selected_chips[*].price_delta)
```

Update saat chip toggle / qty change.

### 7.7. Save logic (frontend merge)

Saat tap Simpan, helper `mergeItemsByPresets(porsiArray) → Item[]`:

```ts
// Pseudo
function mergeItemsByPresets(porsi: PorsiSelection[]): ItemPayload[] {
  const groups = new Map<string, PorsiSelection[]>();
  for (const p of porsi) {
    const key = JSON.stringify(
      [...p.note_presets_snapshot].sort((a,b) => a.id.localeCompare(b.id))
    );
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
  }
  return [...groups.values()].map(group => ({
    menu_id: group[0].menu_id,
    qty: group.length,
    notes: group[0].notes,
    note_presets_snapshot: group[0].note_presets_snapshot,
  }));
}
```

Live di `lib/transactions.ts`. TDD with multiple test cases:
- All porsi same → 1 item qty=N
- All porsi different → N items qty=1
- Mixed (Dada×2, Paha×1) → 2 items (qty=2, qty=1)
- qty=1 menu without presets → 1 item
- Empty presets → no merge needed

### 7.8. Edit mode (open existing item)

Modal buka untuk existing row:
- Initial state: porsi cards di-prefill dengan `qty` cards yang semua sama (initialized from snapshot)
- Kasir bisa edit per-porsi → save merge re-runs
- **Tidak ada auto-merge UI** untuk multiple existing rows same menu different chips. Kalau ada 2 rows ayam goreng (Dada qty=1, Paha qty=1), user lihat 2 rows terpisah di review list. Tidak di-merge ke 1 entry qty=2.

### 7.9. OCR integration (heuristik kecil, MVP)

Saat modal pre-filled dari OCR result:
- `notes` text (e.g. "DP") tampil di free-text field
- Heuristik: kalau `notes` (lowercased) contain substring label chip (lowercased), auto-toggle chip → kasir review
- Contoh: notes="Dada" → auto-pick chip "Dada" di porsi 1 (jika ada)
- Bonus, bukan blocking. Implementation di `nota-item-modal` mount effect.

## 8. Component file organization

- `components/nota-item-modal.tsx` — main shell, sudah ada
- `components/note-preset-picker.tsx` — **BARU**. Chip picker per-porsi. Reusable untuk POS Plan B nanti. Props: `presets: NotePreset[]`, `selected: NotePresetSnapshot[]`, `onChange: (next) => void`
- `components/note-preset-editor.tsx` — **BARU**. Master menu chip CRUD editor
- `lib/transactions.ts` — extend dengan `mergeItemsByPresets()` helper (TDD)

Pertimbangan: kalau `nota-item-modal.tsx` >300 lines setelah extension, split lagi. Tapi default keep di single file.

## 9. Migration (schema only, no data migration)

`supabase/migrations/0003_note_presets.sql`:

```sql
-- Add note_presets column to menus
ALTER TABLE menus
  ADD COLUMN note_presets jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Add note_presets_snapshot column to transaction_items
ALTER TABLE transaction_items
  ADD COLUMN note_presets_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Optional CHECK constraint: array structure (Postgres jsonb_typeof)
ALTER TABLE menus
  ADD CONSTRAINT note_presets_is_array CHECK (jsonb_typeof(note_presets) = 'array');
ALTER TABLE transaction_items
  ADD CONSTRAINT note_presets_snapshot_is_array CHECK (jsonb_typeof(note_presets_snapshot) = 'array');
```

No data migration needed. Existing rows default `[]`.

## 10. Testing

### 10.1. Unit tests

- `lib/transactions.ts` — `mergeItemsByPresets()` dengan semua case di Section 7.7
- API route validation — Zod schema accept/reject tests
- Math: `line_total` with various preset combinations

### 10.2. Manual smoke

- `/menu`: tap Edit menu → buka modal → tambah chip "Dada" mutex_group=bagian → save → reload → chip persists
- `/scan` flow: foto nota ayam goreng qty=2 → review → modal tampil per-porsi cards → tap Dada porsi 1, Paha porsi 2 → save → detail tampil 2 rows ayam goreng (1× Dada, 1× Paha)
- `/reports/daily`: total reflect add-on revenue (kalau Paha atas +3rb dipilih)

## 11. Performance & scale considerations

- `note_presets` per menu ≤ 20 chip → JSONB stays small (<1KB per menu row)
- `note_presets_snapshot` per item ≤ N (N = mutex_group count + additive count, realistic ≤ 8) → <500 byte per item
- Index: tidak perlu khusus. Existing indexes tetap berlaku.
- Query overhead: ignorable. JSONB stored inline di row.

## 12. Out of scope (defer)

- POS direct order page (`/pos`) — Plan B
- OCR Gemini learn chip schema langsung
- Chip dengan stock (mis. "Dada habis hari ini")
- Per-porsi catatan lain berbeda
- Bulk copy chip dari menu lain di MenuForm
- Live preview di MenuForm (skip kalau MVP scope tight)
- Negative price_delta (discount via chip)
- Chip image / icon
- Translate multi-bahasa

## 13. Update main spec & backlog

Setelah merge:

- Edit `docs/superpowers/specs/2026-06-20-pak-pon-design.md`:
  - Section 3 Q3 — tandai keputusan "notes sebagai catatan dapur, BUKAN variant menu" sebagai **superseded** by spec ini. Notes sekarang punya struktur chip dengan optional price_delta. (Argumen: pain riil owner mengubah trade-off.)
  - Section 14 "Conventions" — tambah bullet: "Menu note presets disimpan inline di `menus.note_presets` JSONB. Tx capture pakai `transaction_items.note_presets_snapshot` JSONB."
- Edit `docs/tasks.md` Backlog:
  - Mark "POS direct order — Notes per item + Quick-pick chips" sebagai Plan A done (link ke spec ini), Plan B (POS page) tetap di backlog
