# POS Direct Order (Plan B of POS feature) — Design Spec

**Date:** 2026-06-21
**Status:** Approved (brainstorming phase complete, plan deferred until owner approval)
**Depends on:** Plan A (`2026-06-21-menu-note-presets-design.md`) — MUST land first. Plan B reuse `<NotePresetPicker>`, `<NotaItemModal>`, `mergeItemsByPresets()`, mutex validation, dan kolom `transaction_items.note_presets_snapshot`.

## 1. Latar belakang

Owner sekarang pakai Luna POS. Pain saat ramai: kasir input lambat karena harus ketik notes manual ("dada paha jangan terlalu garing") di tab tablet. Plan A menyelesaikan typing notes (chip-based) tapi flow-nya masih via /scan/review (perlu foto nota fisik).

Plan B = halaman POS baru `/pos` untuk input order langsung tanpa nota fisik. Optimized for speed saat ramai: split view tablet landscape, inline chip picker (no modal), 1-tap add untuk item tanpa chip. Tx tersimpan langsung `confirmed` (no review step).

## 2. Tujuan

- Kasir input order direct ke sistem tanpa foto nota
- Speed-optimized untuk tablet landscape saat ramai
- Reuse infrastruktur Plan A (chip picker, merge save, mutex validation)
- Resilient terhadap tablet refresh / tab close (localStorage backup)
- Idempotent POST (cegah duplicate kalau retry setelah network glitch)
- Tx tersimpan langsung `status='confirmed'`, edit nanti via `/transactions/[id]` existing

## 3. Non-goals

- Payment method tracking (out-of-scope per main spec Q4)
- Print struk digital (separate backlog)
- Send to kitchen display system (KDS)
- Discount / promo / paket kombo
- Tax / service charge
- Pelanggan loyalty / langganan persistent tagging
- Multi-kasir concurrent order
- Voice input / barcode / QR menu
- Reservasi
- Offline-first PWA (cart localStorage saja, tidak full offline sync)

## 4. Route & dependency

- **Route**: `/pos` (server component `app/(app)/pos/page.tsx`)
- **Auth**: existing `(app)` layout middleware
- **Dependency**: Plan A merged. Plan B implementation NOT to start until Plan A landed.

## 5. Data flow & state management

### 5.1. Server load

`app/(app)/pos/page.tsx` (server component, `dynamic = 'force-dynamic'`):
- Query semua menus active dengan `note_presets`
- Order by `category, sort_order, name`
- Pass ke client component sebagai prop

### 5.2. Client orchestrator

`components/pos/pos-client.tsx`:

```ts
type CartItem = {
  cart_id: string;                    // local nanoid untuk identify cart row
  menu_id: string;
  menu_name: string;
  unit_price: number;                 // snapshot saat add (menu.price at time of add)
  qty: number;
  notes: string | null;
  note_presets_snapshot: NotePresetSnapshot[];
};

state:
  cart: CartItem[]
  customerName: string
  tableNo: string
  activeMenuId: string | null         // menu yg lagi expanded di panel kiri
  pendingPorsi: PorsiSelection[]      // tentative chip pick sebelum "Add to cart"
  saving: boolean
```

### 5.3. localStorage backup

- Key: `pos-draft-v1`
- Value: `{cart, customerName, tableNo, timestamp}` JSON
- Sync setiap state change, debounced 500ms
- Restore on mount kalau ada
- Clear setelah POST success
- Stale check: kalau timestamp > 24 jam, abaikan restore (kemungkinan kasir sudah lupa)

### 5.4. Idempotency

- Generate `idempotency_key` (UUID) sekali per session/page-mount
- Regenerate setiap setelah save success (untuk session berikutnya)
- Kirim sebagai header `X-Idempotency-Key` di POST
- Server-side: kolom `transactions.idempotency_key UNIQUE` (nullable; only POS uses)
- Server check kalau key already exists → return existing tx_id (200, sama response)

## 6. API: `POST /api/transactions`

### 6.1. Endpoint

```
POST /api/transactions
Headers:
  Content-Type: application/json
  X-Idempotency-Key: <uuid>             (required)
Body:
  {
    customer_name?: string | null,
    table_no?: string | null,
    items: Array<{
      menu_id: string,                  // uuid
      qty: number,                      // int positive
      notes: string | null,
      sort_order: number,               // int ≥0
      note_presets_snapshot: Array<{
        id: string,
        label: string,
        price_delta: number             // int ≥0
      }>
    }>
  }

Response 200:
  { transaction_id: string, total: number }

Response 400:
  { error: 'invalid_body', detail?: string }

Response 401:
  { error: 'unauthorized' }
```

### 6.2. Server-side validation

- Zod schema validates payload (mirror PatchSchema dari Plan A Task 4)
- Items wajib ≥ 1
- Cross-mutex validation pakai helper dari Plan A (lookup menu master, validate mutex groups)
- Customer/table optional, trimmed empty → null
- `X-Idempotency-Key` required & valid UUID format → 400 kalau missing

### 6.3. Insert flow

1. Validate Zod + mutex
2. Check idempotency: `SELECT id FROM transactions WHERE idempotency_key = $key`
   - Kalau ada: return existing tx_id (200)
3. Insert `transactions` row:
   ```sql
   INSERT INTO transactions (
     idempotency_key,
     status, confirmed_at,
     customer_name, table_no,
     scan_image_path, handwritten_total
   ) VALUES (
     $key,
     'confirmed', now(),
     $customer, $table,
     NULL, NULL
   ) RETURNING id;
   ```
4. Compute snapshot per item: lookup menu name + base price via single batched query, build `transaction_items` rows
5. Insert `transaction_items` batch
6. Return `{transaction_id, total}`

### 6.4. Wide-event logging

Standar pattern (`newEvent`, `tagStatus`, `evt.set/merge/error`, `evt.emit()` in finally). Key fields: `idempotency_key`, `item_count`, `total`, `customer_name_present`, `table_no_present`.

## 7. Schema migration

`supabase/migrations/0005_transactions_idempotency_key.sql`:

```sql
ALTER TABLE transactions
  ADD COLUMN idempotency_key text;

CREATE UNIQUE INDEX transactions_idempotency_key_unique
  ON transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN transactions.idempotency_key IS
  'Optional UUID for POS direct order dedup. NULL for /scan flow.';
```

Partial index supaya nullable + unique tidak bentrok untuk existing rows. Existing data: NULL by default → safe.

## 8. Menu panel UI (kiri, ~60% width)

### 8.1. Layout

```
┌─ Menu panel ────────────────────────────┐
│ [Makanan] [Nasi] [Minuman]              │
│ [🔍 Cari menu…]                        │
│                                         │
│ • Pecel Lele           Rp 16.000   [+] │
│ • Ayam Goreng          Rp 19.000   [+] │
│ • Ayam Bakar           Rp 19.000   [+] │
│ • Sop Ayam             Rp 30.000   [+] │
│ ...                                     │
└─────────────────────────────────────────┘
```

### 8.2. Tab kategori

3 tab: **Makanan** (default), Nasi & side, Minuman. Pakai shadcn `Tabs` atau RadioGroup pattern dari Plan A (segmented). State: `activeCategory`.

### 8.3. Search

Input top of panel. Real-time substring case-insensitive match by `menu.name`. Search non-empty → abaikan tab category (search across all). Empty result → "Tidak ada menu cocok."

### 8.4. Menu row — case 1: tanpa chip presets

Tap `[+]` atau row anywhere → langsung add `{qty: 1, note_presets_snapshot: []}` ke cart. Single-tap. Visual feedback: row briefly highlight + toast singkat "+ {menu name}".

### 8.5. Menu row — case 2: dengan chip presets

Tap row → row expand inline. Layout expanded:

```
• Ayam Goreng           Rp 19.000   [▼]
  ┌─ Bagian (pilih 1) ──────────────┐
  │ [●Dada] [○Paha] [○Paha atas+3rb]│
  └─────────────────────────────────┘
  ┌─ Tambahan ──────────────────────┐
  │ [☐Extra sambel+2rb] [☐No kulit] │
  │ [☐Jangan garing]                │
  └─────────────────────────────────┘
  Qty: [−] 1 [+]   Total: Rp 19.000
  [✗ Batal]       [✓ Tambah ke cart]
```

Pakai `<NotePresetPicker>` dari Plan A. Qty stepper inline.

Untuk qty > 1 + ada `mutex_group` di menu → expand jadi per-porsi cards (sama pattern Plan A modal):

```
  ┌─ Porsi 1 of 2 ──────────────────┐
  │ Bagian: [●Dada] [○Paha]         │
  └─────────────────────────────────┘
  ┌─ Porsi 2 of 2 ──────────────────┐
  │ Bagian: [○Dada] [●Paha]         │
  └─────────────────────────────────┘
  [↻ Samakan semua porsi dengan #1]
```

Tap `[✓ Tambah ke cart]` → frontend `mergeItemsByPresets()` → push 1 atau N entries ke cart → row collapse + reset pending state → ready untuk menu berikutnya.

### 8.6. State expand/collapse

Hanya 1 menu expand pada saat bersamaan. Tap menu lain saat ada yang expanded → collapse yang lama (lose pending chip state), expand yang baru.

### 8.7. Empty menu state

Kalau semua menu di kategori kosong → "Belum ada menu di kategori ini. [+ Tambah dari Master Menu]" link ke `/menu`.

## 9. Cart panel UI (kanan, ~40% width)

### 9.1. Layout

```
┌─ Cart panel ─────────────────────┐
│ Nama  [Pak Budi___________]      │
│ Meja  [5______]                  │
│                                  │
│ ── Items ──                      │
│ 1× Pecel Lele                    │
│    Rp 16.000          [✏][🗑]   │
│ ─────────────────────────────    │
│ 1× Ayam Goreng                   │
│    [Dada] [Extra sambel]         │
│    Rp 21.000          [✏][🗑]   │
│ ─────────────────────────────    │
│ 1× Ayam Goreng                   │
│    [Paha]                        │
│    Rp 19.000          [✏][🗑]   │
│ ─────────────────────────────    │
│ 2× Es Teh                        │
│    Rp 12.000          [✏][🗑]   │
│                                  │
│ ── Ringkasan ──                  │
│ Total           Rp 68.000        │
│                                  │
│ [🗑 Kosongkan]   [✓ Selesai]    │
└──────────────────────────────────┘
```

### 9.2. Customer name + table no

- **Nama**: Input free-text, opsional. Autocomplete dari `localStorage` 5 nama terakhir (key `pos-recent-names-v1`).
- **Meja**: Input free-text pendek (max 6 char), opsional.

Keduanya saved ke localStorage backup dengan cart.

### 9.3. Cart item row

- **Qty × menu_name** di atas (bold)
- **Chip pills** (jika ada) — sama style Plan A item-row display
- **Free-text notes** italic kecil di bawah chips (jika ada)
- **Line total** di kanan bawah: `qty × (unit_price + Σ price_deltas)`
- **Aksi**: `[✏ Edit]` dan `[🗑 Hapus]`

### 9.4. Edit cart item

Tap `[✏]` → buka `<NotaItemModal>` (Plan A reuse) pre-filled dengan item data. Modal handle per-porsi + chip picker + merge save.

`onSave(mergedItems)`:
1. Hapus cart item lama (`cart_id` reference)
2. Push `mergedItems` ke cart (1 atau N entries baru dengan `cart_id` baru)
3. Modal close

### 9.5. Hapus cart item

Tap `[🗑]` → inline confirmation toggle "Hapus item ini?" → tap "Ya" → remove dari cart. Tidak pakai AlertDialog (lighter, lebih cepat).

### 9.6. Kosongkan cart

Tap `[🗑 Kosongkan]` → AlertDialog "Hapus semua item dari cart?" → konfirmasi → cart cleared + localStorage cleared. (Pakai AlertDialog karena destructive bulk action.)

### 9.7. Empty state

Cart kosong → text "Cart kosong. Pilih menu di sebelah kiri untuk mulai order." Tombol Selesai disabled.

### 9.8. Selesai button

- Disabled saat `cart.length === 0` atau `saving === true`
- Loading text: "Menyimpan…"
- Tap:
  1. Set `saving=true`
  2. POST `/api/transactions` dengan `X-Idempotency-Key` header + body
  3. Success → clear cart + customer/table + localStorage → toast "Order tersimpan: Rp X" dengan action "Lihat" → `router.push(/transactions/${tx_id})`
  4. Error network → toast error + retry button. Cart state intact (state + localStorage).
  5. Error 400 (validation) → toast dengan detail. Tidak clear cart (kasir review + fix).

### 9.9. Total math

Real-time updates:

```ts
const total = cart.reduce((sum, item) => {
  const adds = item.note_presets_snapshot.reduce((s, p) => s + p.price_delta, 0);
  return sum + item.qty * (item.unit_price + adds);
}, 0);
```

## 10. Mobile responsive (md breakpoint)

Tablet landscape (`md+`): split 60/40 horizontal.
Mobile portrait (`<md`): stacked vertical dengan sticky bottom cart drawer.

```
┌─ Mobile portrait ──────┐
│ [Makanan][Nasi][Mnm]   │
│ [🔍 Cari menu]        │
│                        │
│ • Pecel Lele      [+] │
│ • Ayam Goreng     [+] │
│ • Es Teh          [+] │
│ ...                    │
│                        │
└────────────────────────┘
┌────────────────────────┐  ◀ Sticky bottom
│ Cart (3) — Rp 60.000   │
│              [▲ Buka]  │
└────────────────────────┘
```

Tap drawer header → expand `<Sheet>` (shadcn) fullscreen menampilkan cart panel content (info pelanggan, items, ringkasan, Selesai). Tap "Tutup" / esc / backdrop → kembali ke menu picker.

Pakai shadcn `Sheet` component — perlu install dulu: `npx shadcn@latest add sheet`. Documented sebagai sub-step di plan.

## 11. Home tile integration

`app/(app)/page.tsx` (Home): tambah tile "POS" di samping tile Scan. Dua entry points utama:

```
┌─ Mau lakukan apa? ──────────────────────┐
│ [📷 Scan nota]  [📋 POS direct]         │
│ [🧾 History]    [📊 Reports]            │
│ [🍽️ Menu]                               │
└─────────────────────────────────────────┘
```

(Atau adjust grid layout supaya 5 tiles fit responsively. Lihat existing `<HomeTiles>` component.)

## 12. Edge cases

| Case | Handling |
|---|---|
| Network putus saat Selesai | Fetch error → toast retry. Cart intact (state + localStorage). Idempotency_key cegah duplicate kalau retry sukses setelah server actually committed. |
| Tablet refresh / tab close | localStorage backup restore on mount. Stale > 24 jam → ignore (avoid old draft confuse kasir). |
| Menu master diubah saat sedang input | Cart pakai snapshot — tidak terganggu. Menu list kiri pakai harga lama sampai refresh. Trade-off kecil acceptable untuk internal app. |
| Menu di-nonaktif saat ada di cart | Save tetap bisa (pakai snapshot). Tidak bisa add menu itu lagi (filter is_active=true). |
| Mutex violation di payload | Frontend `mergeItemsByPresets` produce mutex-correct snapshot. Server cross-mutex validation (Plan A reuse) catch malicious payload → 400. |
| Empty cart Selesai | Tombol disabled. Tidak mungkin. |
| Idempotency key reuse (kasir retry setelah server actually committed) | Server lookup existing tx by key → return existing `transaction_id` (200) → client treat as success → redirect ke detail. |
| User klik Selesai ganda cepat | Frontend disable button saat saving. Defense in depth: idempotency_key cegah duplicate di server. |

## 13. Component file organization

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/0005_transactions_idempotency_key.sql` | Create | Schema migration |
| `app/api/transactions/route.ts` | Modify | Add POST handler (sekarang cuma GET) |
| `app/(app)/pos/page.tsx` | Create | Server load menus + render client |
| `components/pos/pos-client.tsx` | Create | Orchestrator: state, localStorage, save flow |
| `components/pos/menu-panel.tsx` | Create | Menu list + tabs + search |
| `components/pos/menu-row.tsx` | Create | Collapse/expand + chip picker integration |
| `components/pos/cart-panel.tsx` | Create | Cart + customer + total + Selesai |
| `components/pos/cart-item-row.tsx` | Create | Single cart row dengan edit/delete |
| `components/home-tiles.tsx` | Modify | Add POS tile |
| `components/ui/sheet.tsx` | Create (via shadcn add) | Mobile cart drawer |

Reuse from Plan A:
- `components/note-preset-picker.tsx` — chip picker dipakai inline di menu-row
- `components/nota-item-modal.tsx` — edit cart item via modal (Plan A handle per-porsi + chip + merge save)
- `lib/transactions.ts` `mergeItemsByPresets()` + `NotePresetSnapshot` + `PorsiSelection`
- Mutex validation helper di `app/api/transactions/[id]/route.ts` (refactor jadi shared `lib/transaction-validation.ts` saat implementation)

## 14. Testing

### 14.1. Unit tests

- `mergeItemsByPresets` sudah covered di Plan A
- POST `/api/transactions` schema validation — Zod accept/reject cases
- Idempotency lookup helper (in-route or extracted utility)

### 14.2. Integration / manual smoke

- Buka `/pos` di tablet landscape → split view tampil
- Tap menu tanpa chip (Pecel Lele) → add cart 1× → confirm di kanan
- Tap menu dengan chip (Ayam Goreng) → expand → pick Dada → qty 2 → per-porsi cards → pick Dada keduanya → add → 1 cart entry qty=2
- Tap Ayam Goreng lagi → qty 2 → porsi 1 Dada, porsi 2 Paha → add → 2 cart entries
- Edit cart entry → modal open → change → save
- Hapus cart entry → inline confirm → remove
- Customer name + meja → autocomplete works
- Tap Selesai → POST → redirect ke detail
- Refresh page mid-cart → restore from localStorage
- Network off + tap Selesai → toast error + retry
- Network on + retry → success → no duplicate
- Mobile portrait → stacked + sheet cart drawer

## 15. Performance & scale

- Menu list: ≤ 30 items typical, full render fine. Search/filter di client.
- Cart: typical 5-15 items per order, very small.
- localStorage size: cart ≤ 2 KB, well under 5 MB browser limit.
- POST latency: target < 500 ms (single DB insert + items batch). Acceptable buat ramai.

## 16. Out of scope (defer)

- Payment method tracking
- Print struk digital
- Kitchen display system (KDS) integration
- Discount / promo / paket kombo
- Tax / service charge
- Customer loyalty / tag persistent
- Multi-kasir concurrent order
- Voice input / barcode / QR menu
- Reservasi
- Full PWA offline sync
- Quick-add favorites at top of menu panel (future enhancement)
- Tip / round-up
- Receipt email/WA to customer

## 17. Update docs setelah merge

- `docs/superpowers/specs/2026-06-20-pak-pon-design.md`:
  - Section 16 — tambah bullet bahwa /pos sebagai entry point utama (selain /scan) untuk direct order
  - Section 14 — convention bullet: "Direct order via `POST /api/transactions` dengan `X-Idempotency-Key` header. /scan flow tetap pakai pending_review."
- `docs/tasks.md`:
  - Mark Plan B done di backlog POS section
  - Add Plan 6 entry dengan task list summary
