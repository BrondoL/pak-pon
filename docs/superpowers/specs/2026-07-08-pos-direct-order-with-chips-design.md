# POS Direct Order + Per-Menu Chips — Design Spec

**Date:** 2026-07-08
**Status:** Approved (brainstorming complete, ready for implementation plan)
**Supersedes:**
- `2026-06-21-menu-note-presets-design.md` (never implemented — 0 code refs to `note_presets`)
- `2026-06-21-pos-direct-order-design.md` (Plan B never implemented, was blocked on Plan A)

**Backlog item:** `docs/tasks.md` §Backlog → "POS / Order entry → POS direct order"

## 1. Motivation

Kasir sekarang cuma bisa input transaksi lewat foto nota (`/scan`, OCR Gemini). Ada dua kondisi yang butuh **input langsung tanpa nota fisik**:

1. **Dine-in cepat saat ramai** — nota fisik dianggap lambat / ga perlu (kasir langsung ke tablet).
2. **Nota fisik habis** — tetap harus bisa jalan.

Sekaligus solve pain "notes ketikan panjang di modal" (mis. "dada paha jangan terlalu garing") lewat **per-menu chips** dengan optional harga tambahan. Chip di sini = shortcut button di picker yang bisa:
- Nambah label ke `notes` field (mis. "Dada", "Goreng garing"), dan
- Optionally nambah harga per satuan (mis. "Paha atas" +3.000).

Ini bukan variant menu — kalau beda harga signifikan (mis. Dada vs Sayap +5k), tetap OK jadi chip berbayar. Kalau beda banget (ayam vs bebek), tetap jadi menu terpisah.

## 2. Goals

- Kasir bisa build order dari zero (menu picker + qty + chip + notes) → simpan → auto-print kitchen.
- Chip per menu di master, multi-select dengan optional `mutex_group` (radio behavior per grup), dan optional `price_delta` (≥0).
- Reuse maksimal komponen review-form existing (cart, save, print dispatch, is_takeaway, customer_name, table_no).
- Zero regression di OCR/scan flow — items OCR default `applied_chips = []`, rendering tetap jalan.
- Edit POS transaksi belakangan tetap possible via `/transactions/[id]/review` existing (extended untuk chip).

## 3. Non-goals

- **Global/shared chips** — semua chip per-menu. Duplikasi manual accepted.
- **Drag reorder chip** — pakai urutan array. Delete-recreate kalau urut ulang.
- **Discount / `price_delta < 0`** — CHECK constraint block.
- **Chip usage reporting** di UI — data tersimpan di `applied_chips` jsonb, dashboard belakangan.
- **Bulk import / template default chip** — owner input manual per menu.
- **Mark menu "habis hari ini"** — deferred, sekalian fitur stock management (backlog terpisah).
- **POS "save draft"** — POS always `confirmed` + auto-print in one shot. Batal → state hilang (no persistence).
- **Auto-split multi-porsi item** (mis. "2 ayam, 1 dada 1 paha" jadi 2 rows auto) — kasir input manual 2 items.
- **localStorage cart backup** — YAGNI. Kalau tablet refresh mid-input, kasir input ulang.
- **Idempotency key POST** — YAGNI untuk warung volume kecil, kasir aware kalau double-tap.
- **Payment method tracking / diskon / tax / service charge** — konsisten dengan main spec MVP.
- **Print struk digital PDF/WA** — separate backlog.

## 4. Data model

### 4.1. Table baru: `menu_chips`

```sql
CREATE TABLE menu_chips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id uuid NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  label text NOT NULL,
  price_delta bigint NOT NULL DEFAULT 0 CHECK (price_delta >= 0),
  mutex_group text,                       -- nullable; chip dengan mutex_group sama = mutually exclusive
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (menu_id, label)
);

CREATE INDEX idx_menu_chips_menu_id_sort
  ON menu_chips(menu_id, sort_order);
```

Design notes:
- **Separate table (bukan JSONB di `menus`)** — supaya UNIQUE(menu_id, label) enforceable, CRUD per chip clean, dan future chip-level reporting bisa join tanpa jsonb path noise.
- **`price_delta bigint >= 0`** — chip cuma nambah atau nol, no discount.
- **`sort_order`** — display order (owner atur via urutan input di menu master).
- **`mutex_group` nullable text** — chip dengan `mutex_group` string sama = mutually exclusive (radio behavior di picker). `NULL` = multi-select (default). Contoh: chip "Dada", "Paha", "Paha atas" semua `mutex_group='bagian'` → cuma bisa pilih 1 dari 3. Chip "Extra pedas" `mutex_group=NULL` → bebas kombinasi.
- **Hard-delete via `ON DELETE CASCADE`** — kalau owner hapus chip di master, DELETE row. Snapshot di `transaction_items.applied_chips` udah frozen, ga terganggu.
- **Tidak ada `is_active`** — hard-delete cukup (agreed). Historical transaksi tetap intact via snapshot.

Trigger `updated_at` follow pattern existing `menus`.

### 4.2. Kolom baru di `transaction_items`

```sql
ALTER TABLE transaction_items
  ADD COLUMN applied_chips jsonb NOT NULL DEFAULT '[]'::jsonb;
```

Structure:
```json
[
  {"label": "Paha atas", "price_delta": 3000},
  {"label": "Goreng garing", "price_delta": 0}
]
```

**Snapshot-style (bukan FK ke `menu_chips.id`).** Konsisten dengan `menu_name_snapshot` + `unit_price_snapshot`. Frozen at save time.

**`mutex_group` tidak disnapshot** — cuma constraint saat input di picker. Setelah tersimpan, ga ada guna nyimpen (chip udah legit pilih 1 dari grup, sisa historis). Ini kurangi field noise di jsonb + simplify report aggregation.

### 4.3. Kolom `unit_price_snapshot` behavior

POS/PATCH save:
```
unit_price_snapshot = base_menu_price + Σ(applied_chips[*].price_delta)
```

Total line = `unit_price_snapshot × qty`. No schema change.

### 4.4. `notes` field

`notes` cuma isi **free-text ad-hoc**. Chip data terpisah di `applied_chips`. Rendering combine di sisi consumer.

Backward compat: OCR items yang taruh label langsung di `notes` (mis. "DP", "Dada" dari nota tulisan tangan) tetap jalan — `applied_chips` default `[]`, rendering handle empty.

### 4.5. Migrasi tambahan: `scan_image_path` nullable

Kalau kolom `transactions.scan_image_path` currently `NOT NULL`, migrasi bikin nullable (POS transaction store NULL — ga ada foto).

Verify saat implementation via `\d transactions`; migrasi 1-liner ALTER kalau perlu.

### 4.6. Migration file

Satu file baru: `supabase/migrations/00XX_pos_menu_chips.sql` (nomor next available) — bikin `menu_chips`, ALTER `transaction_items` add `applied_chips`, ALTER `transactions.scan_image_path` nullable (kalau perlu), trigger `updated_at`.

## 5. UX & user flow

### 5.1. Route & entry point

- **Route baru**: `app/(app)/pos/page.tsx` — server component. Auth via existing `(app)` middleware.
- **Home tile**: tambah 1 entry "Buat pesanan" di `components/home-tiles.tsx`, urutan:
  - Scan nota (OCR flow) — existing
  - **Buat pesanan (POS)** — baru
  - Transaksi
  - Menu
  - Reports

### 5.2. Layout `/pos` (Option C — hybrid)

Tablet landscape primer, 2-kolom:

```
┌───────────────────────────────┬──────────────────────────┐
│ MENU PICKER (kiri, ~5/12)     │ CART (kanan, ~7/12)      │
│                               │                          │
│ [Search / filter kategori]    │ [Nama]  [No. Meja]       │
│                               │ [📦 Dibungkus toggle]    │
│ Kategori: Makanan             │                          │
│ ┌─────┐┌─────┐┌─────┐         │ ── Items ──              │
│ │Ayam ││Lele ││Nasi │         │ 2× Ayam Goreng           │
│ │22k  ││22k  ││5k   │         │    Dada, Goreng garing   │
│ └─────┘└─────┘└─────┘         │    [✏️] [🗑] Rp 50.000  │
│                               │                          │
│ Kategori: Minuman             │ 1× Es Teh                │
│ ┌─────┐┌─────┐                │    Manis                 │
│ │EsTeh││EsJer│                │    [✏️] [🗑] Rp 5.000   │
│ └─────┘└─────┘                │                          │
│                               │ ────────────────         │
│ Kategori: Nasi                │ Total sistem: Rp 55.000  │
│ ...                           │                          │
│                               │ [ Batal ] [✓ Simpan &   │
│                               │           Cetak ]        │
└───────────────────────────────┴──────────────────────────┘
```

**Mobile** (HP kasir): 1-kolom stacked. Menu picker atas, cart bawah dengan sticky footer total + Simpan.

### 5.3. Menu card interaction

Tap menu card → drawer/modal "Konfigurasi item" muncul (reuse `NotaItemModal` extended):

```
Ayam Goreng — Rp 22.000
Qty: [ - ] 2 [ + ]

Bagian (pilih satu):                    ← mutex group: "bagian"
  ( Dada )  ( Paha )  ( Paha atas +3k )

Pilihan cepat:                          ← mutex_group = NULL
[ Extra pedas +2k ] [ DP ] [ Goreng garing ]

Catatan tambahan (opsional):
[________________________________]

Subtotal: Rp 50.000
[ Batal ]  [ + Tambah ke cart ]
```

**Chip render rule**:
- Chip dengan `mutex_group` sama → grouped di section terpisah dengan heading dari grup name (mis. "Bagian:", "Level pedas:"). Radio behavior — tap 1 chip auto-untap sibling dalam grup yang sama. Boleh 0 selected (grup ga wajib pilih).
- Chip `mutex_group = NULL` → di section "Pilihan cepat" dengan heading generic. Toggle multi-select bebas.
- Chip label: `label` kalau `price_delta = 0`, `label +Xk` kalau `price_delta > 0`.
- Price delta live-update di Subtotal saat chip toggled.

**Ordering**:
- Section mutex groups muncul dulu (urut sesuai `min(sort_order)` per grup).
- Section "Pilihan cepat" (multi-select) muncul di bawah.
- Dalam tiap section, chip urut by `sort_order`.

**Menu tanpa chip** → skip chip sections, modal langsung Qty + Notes + Add.

### 5.4. Edit item di cart

Tap ✏️ pada row cart → modal yang sama muncul dengan state prefill (qty + chip selection + notes). Save → replace item di cart.

### 5.5. Save flow

1. Client validate: minimal 1 item.
2. `POST /api/pos` dengan payload (§6.1).
3. Client dispatch print (dapur + minuman split) via `POST /api/print/send` — persis sama seperti review-form save flow.
4. Redirect ke Home dengan toast success.

**Batal button** → confirm dialog kalau cart non-empty ("Batalkan pesanan? Semua item hilang.") → clear state → back ke Home. Reuse `AlertDialog` shadcn.

## 6. API surface

### 6.1. `POST /api/pos` (baru)

Bikin transaksi `confirmed` + items dalam 1 request. Skip `pending_review`.

**Request**:
```ts
{
  customer_name: string | null,
  table_no: string | null,
  is_takeaway: boolean,
  items: Array<{
    menu_id: uuid,
    qty: number,                    // >= 1
    chip_labels: string[],          // ["Dada", "Goreng garing"] — labels only
    notes: string | null,           // free-text
    sort_order: number,
  }>
}
```

**Server flow**:
1. Zod validate payload.
2. Fetch `menus` yang di-refer + `menu_chips` WHERE `menu_id IN (...) AND label IN (...)`.
3. Per item:
   - Base price + `menu_name_snapshot` dari `menus`.
   - `applied_chips` = matched chip rows → `[{label, price_delta}]` (order sesuai `chip_labels` client).
   - `unit_price_snapshot = base + Σ price_delta`.
   - Kalau ada `chip_label` yang ga match (chip di-hard-delete mid-session atau typo) → **400 dengan detail chip mana yang invalid** (fail-loud, client refresh menu + retry).
   - **Mutex validation**: kalau 2+ chip di item sama datang dari `mutex_group` yang sama (non-null) → **400 dengan detail "chip A dan chip B dari grup X mutually exclusive"**. Defense-in-depth di server — client picker mestinya udah cegah, tapi payload manipulasi tetap di-reject.
4. `INSERT INTO transactions` status=`confirmed`, `confirmed_at=now()`, `daily_seq` via mekanisme existing (reuse dari PATCH transaction confirm flow — RPC atau trigger yang sudah ada).
5. `INSERT INTO transaction_items` batch dengan `applied_chips` jsonb.
6. Return `{ transaction, items }` — client dispatch print.

**Server-side snapshot (bukan client-sent price)** — cegah tampering. Client cuma kirim `chip_labels: string[]`.

**Wide-event log** (`lib/logger.ts` pattern):
- Event: `pos_transaction_created`
- Fields: `tx_id`, `item_count`, `total_amount`, `chip_count` (total chips applied), `is_takeaway`, `has_free_notes`, `elapsed_ms`.

### 6.2. `GET /api/menus` (extended)

Response tiap menu tambah field `chips`:

```ts
{
  id, name, price, category, is_active,
  chips: Array<{
    id, label, price_delta, mutex_group, sort_order
  }>
}
```

Payload nambah minor (~10-20 chip total di warung realistis). Dipakai `/pos` picker + menu master edit + `nota-item-modal` chip picker.

### 6.3. `POST /api/menus` + `PATCH /api/menus/[id]` (extended)

Payload tambah optional `chips` array — replace-all diff pattern:

```ts
{
  name, price, category, is_active,
  chips: Array<{
    id?: uuid,                  // existing: UPDATE; missing: INSERT
    label: string,
    price_delta: number,
    mutex_group: string | null,
    sort_order: number,
  }>
}
```

Server diff (hard-delete):
- Chip di DB tapi ga di payload → **DELETE**
- Chip di payload dengan `id` → **UPDATE**
- Chip di payload tanpa `id` → **INSERT**

Alternatif transactional: DELETE all + INSERT all fresh (simpler code, same UX). Choice di plan phase.

### 6.4. `PATCH /api/transactions/[id]` (extended)

Payload `items[]` tiap item tambah optional `chip_labels: string[]`. Server jalanin snapshot logic sama seperti `POST /api/pos`. Kalau item existing (OCR-origin) ga kirim `chip_labels` → default `[]`, `applied_chips` tetap `[]`.

Ini yang bikin edit-item di review page (existing) juga bisa handle chip — relevan buat POS transaksi yang di-edit belakangan, atau kalau kasir mau upgrade OCR item ke chip-style.

## 7. Menu master chip CRUD UI

Extend `components/menu-form.tsx` (Dialog edit menu existing) — section baru di bawah field harga.

### 7.1. Chip editor layout

```
┌─ Edit Menu ─────────────────────────────────┐
│ Nama:      [ Ayam Goreng          ]         │
│ Harga:     [ Rp 22.000             ]        │
│ Kategori:  ( ) Makanan  ( ) Nasi  ( ) Minuman│
│                                              │
│ ── Pilihan cepat (chips) ─────────────       │
│  ℹ Muncul di POS saat kasir tap menu ini.   │
│    Isi harga tambahan (0 = tidak nambah).   │
│    Isi "Grup" untuk pilihan eksklusif       │
│    (mis. "bagian" → Dada/Paha/Sayap ex 1).  │
│                                              │
│ ┌───────────────┬────────┬──────────┬─────┐ │
│ │ Label         │ +Harga │ Grup     │     │ │
│ ├───────────────┼────────┼──────────┼─────┤ │
│ │ [ Dada      ] │ [ 0  ] │ [bagian] │ [🗑]│ │
│ │ [ Paha      ] │ [ 0  ] │ [bagian] │ [🗑]│ │
│ │ [ Paha atas ] │ [3000] │ [bagian] │ [🗑]│ │
│ │ [ Extra pdas] │ [2000] │ [      ] │ [🗑]│ │
│ │ [ DP        ] │ [ 0  ] │ [      ] │ [🗑]│ │
│ │ [ Grng garing]│ [ 0  ] │ [      ] │ [🗑]│ │
│ └───────────────┴────────┴──────────┴─────┘ │
│                                              │
│  [ + Tambah pilihan ]                        │
│                                              │
│  [ Batal ]  [ ✓ Simpan ]                    │
└──────────────────────────────────────────────┘
```

### 7.2. Behavior

- Inline table 4 kolom: label (text), +Harga (number, min 0), Grup (text nullable), delete.
- "+ Tambah pilihan" → append empty row.
- Delete row → remove dari state (belum persist sampe Simpan).
- **Grup field** — plain text nullable. Owner ketik string identifier bebas (mis. "bagian", "level pedas", "topping"). Chip dengan grup sama = radio behavior di POS picker. Chip kosong = multi-select bebas.
- **Client-side validation** sebelum submit:
  - Empty label → error inline "Isi nama pilihan atau hapus baris ini".
  - Duplikat label case-insensitive → error inline "Label sudah ada".
  - `price_delta < 0` → block (input min="0").
  - Grup dengan cuma 1 chip → warning (bukan error) "Grup '<name>' cuma 1 chip — mutex ga ada efek. Isi grup di chip lain atau kosongkan.".
- Server-side validate ulang (Zod di PATCH/POST menus).

### 7.3. Sort order

- **Skip drag-and-drop untuk MVP.** Chip displayed sesuai urutan input array.
- `sort_order` di DB di-set = index array saat save.
- Kalau owner butuh urut ulang → delete-recreate (rare use, ga worth drag handle di v1).

### 7.4. Menu master list — indikator chip

Di `/menu` list (`components/setup-menu.tsx` atau route page), tambah badge kecil buat menu yang punya chip:

```
Ayam Goreng          Rp 22.000   [5 pilihan] [Edit]
Lele Goreng          Rp 22.000              [Edit]
Es Teh               Rp 5.000    [3 pilihan] [Edit]
```

## 8. Print behavior

### 8.1. Kitchen ticket (dapur + minuman)

Format sekarang: 1 baris `> ${note}` per item (`lib/escpos.ts:189`). Extend: **chip labels di baris terpisah** (biar dapur baca clear), free-text `notes` di baris berikutnya kalau ada.

Contoh:
```
─────────────────────
POS-070826-0034
Meja 5      Pak Budi
─────────────────────
2×  AYAM GORENG              ← double-height (existing)
    Dada, Goreng garing       ← chip labels (bold/highlighted)
    pisah nasinya             ← free-text notes

1×  LELE GORENG
    DP                        ← chip only

3×  NASI PUTIH               ← no chip, no notes
─────────────────────
Total item: 6
```

### 8.2. Customer receipt

Currently **tidak nampilin notes sama sekali** (verified via `lib/escpos.ts:renderCustomerReceipt`). Update: tampil **chip berbayar (`price_delta > 0`) saja**. Chip zero-delta + free-text tetap skip (customer ga peduli detail dapur).

Contoh:
```
POS-070826-0034
Meja 5      Pak Budi
─────────────────────
2× Ayam Goreng    Rp 50.000
   Dada                       ← "Dada" (+3k) tampil, "Goreng garing" (0) skip
1× Lele Goreng    Rp 22.000
   (no chip line — DP = 0)
3× Nasi Putih     Rp 15.000
─────────────────────
Total item: 6
TOTAL          Rp 87.000
─────────────────────
Terima kasih 🙏
```

### 8.3. Render rule ringkasan

| Field | Kitchen | Customer |
|---|---|---|
| `applied_chips` dengan `price_delta > 0` | ✅ tampil | ✅ tampil |
| `applied_chips` dengan `price_delta = 0` | ✅ tampil | ❌ skip |
| `notes` (free-text) | ✅ tampil (baris terpisah, `>` prefix) | ❌ skip |

### 8.4. `lib/escpos.ts` changes

`RenderItem` shape extended:
```ts
{
  qty, name, unit_price, note,
  applied_chips?: Array<{ label: string; price_delta: number }>
}
```

Render fn masing-masing filter/format sendiri. Caller (`nota-review-form`, POS page) pass raw `applied_chips` array, render fn pilih chip mana yang tampil per format.

### 8.5. Delta logic edit — chip change = "modified"

Extend `detectModalContext` di `components/nota-review-form.tsx:65` — chip change trigger reprint modal sama seperti qty/menu/notes change:

```ts
const chipsChanged =
  orig.applied_chips.map(c => c.label).sort().join('|') !==
  cur.applied_chips.map(c => c.label).sort().join('|');

const changed = orig.menu_id !== cur.menu_id ||
                orig.qty !== cur.qty ||
                orig.notes !== cur.notes ||
                chipsChanged;
```

### 8.6. Auto-print dispatch (POS save)

Persis sama dengan review-form save flow:
1. `POST /api/pos` return `{ transaction, items }`.
2. Client split items by `menu_category` → dapur (`makanan`/`nasi`) + minuman.
3. Per target non-empty, `POST /api/print/send` dengan `trigger: 'auto'`, `bytes_b64` hasil `renderKitchenTicket`.
4. `printed_*_at` di-flag lewat trigger DB existing (`mark_items_printed_history`).

Zero logic baru di print pipeline — cuma tambah field `applied_chips` di render.

## 9. Reuse points (zero new code)

- Auth middleware `(app)` group.
- `components/home-tiles.tsx` (add 1 tile).
- `is_takeaway` toggle + kitchen banner "*** BUNGKUS ***".
- `customer_name` + `table_no` fields.
- Print dispatch pipeline (`/api/print/send`, FCM, `print_history`, delta logic, primary agent).
- `/transactions/[id]/review` existing page auto-support chip (via extended PATCH + NotaItemModal extended).
- Soft delete / restore / trash.
- Wide-event logger pattern.
- Report daily/monthly aggregation (chip cuma naikin `unit_price_snapshot`, revenue auto-included).

## 10. Skip for POS (kolom NULL)

- `scan_image_path` → NULL (migrasi nullable kalau perlu).
- `handwritten_total` → NULL (banner mismatch di review-form udah handle NULL).
- `ai_meta` → NULL.
- `confidence` per item → default `'high'` atau NULL (POS ga kena kuning/merah highlighting — OCR-only feature).
- `ZoomableNotaImage` component → ga di-render di `/pos` (no photo).

## 11. Testing considerations

- **Unit test** `lib/escpos.ts` render — kitchen shows all chips + free-text, customer receipt shows only paid chips.
- **Unit test** `detectModalContext` — chip change triggers "modified" flag.
- **Unit test** POST `/api/pos` — happy path, invalid chip_label, missing menu_id, server-side price snapshot vs tampering.
- **E2E manual** dev server:
  - Setup menu master dengan chips.
  - `/pos` → add 3 items (mix chip + no chip + free-text) → simpan → verifikasi print job di agent debug page.
  - Edit tx di `/transactions/[id]/review` → toggle chip → reprint modal muncul.
  - OCR flow unchanged: `/scan` masih jalan, items OCR `applied_chips = []`.

## 12. Open questions (untuk plan phase)

- Menu tanpa chip: modal masih muncul (Qty + Notes) atau 1-tap add langsung ke cart dengan qty=1?
- Reuse `NotaItemModal` extended atau bikin `PosItemModal` baru? (Depends on complexity divergence — decide di plan.)
- Chip picker di `/pos` menu card: sub-modal atau expand-inline pada card? (Design shows modal, but inline expand more POS-y. Decide di plan.)
- Menu master chip label max length (Zod cap): 32? 40?
- Menu master chip count max per menu (Zod sanity cap): 15? 20?
- Menu master chip `mutex_group` max length + allowed chars: alphanumeric + spasi + hyphen, max 20 char?
- Mutex UX: kalau kasir tap chip yang sudah aktif di grup mutex, apakah unpick (jadi 0 selected di grup) atau tetap keep (radio strict)? Rekomendasi: unpick — grup ga wajib pilih.
