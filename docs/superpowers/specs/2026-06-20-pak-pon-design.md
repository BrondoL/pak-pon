# Pecel Lele Pak Pon — Design Spec

**Date:** 2026-06-20
**Status:** Approved (brainstorming phase complete, pending implementation plan)

## 1. Overview

Internal web app untuk warung **Pecel Lele Pak Pon** (Bandar Lampung). Bukan public-facing. Dipakai kasir untuk input nota harian (foto → OCR → review → simpan) dan owner untuk melihat reporting harian (closingan) dan bulanan (pemasukan + menu terlaris).

### Tech stack

- **Next.js 16.2** (App Router, React 19.2) — sudah ke-scaffold
- **Supabase** — Postgres database + Auth (email/password) + Storage (foto nota private bucket)
- **Gemini 3.5 Flash** (`gemini-3.5-flash`) — OCR ekstraksi item dari foto nota
- **Vercel** — hosting + Cron (region `sin1` Singapore)
- **Tailwind CSS v4** + TypeScript strict

### Users & roles

**1 akun share** — semua orang (owner, kasir, siapapun) login dengan kredensial yang sama. Tidak ada user management dalam app; akun dibuat 1x via Supabase Dashboard.

## 2. User stories

### US-1 — Scan nota (use case utama, ~24+ per hari)

> Sebagai kasir, saya ambil/upload foto nota di tablet supaya item-item nota otomatis ter-extract dan tersimpan ke sistem dengan minimal input manual.

**Acceptance:**
- Bisa ambil foto langsung dari kamera tablet atau pilih file dari galeri
- Foto di-compress otomatis sebelum upload (target 200-500 KB)
- Hasil OCR muncul dalam ~5-15 detik sebagai list item editable
- Warning visible kalau handwritten total ≠ sum items
- Kasir bisa edit, tambah, hapus item sebelum konfirmasi
- Sekali dikonfirmasi → masuk history & reporting

### US-2 — Closingan harian

> Sebagai kasir/owner, di akhir shift saya lihat total pemasukan hari ini di sistem supaya bisa cocokkan dengan uang fisik di laci.

**Acceptance:**
- Halaman `/reports/daily` menampilkan total pemasukan hari berjalan + jumlah transaksi
- Cut-off harian: business-day, default jam 12:00 WIB (env `NEXT_PUBLIC_BUSINESS_DAY_CUTOFF_HOURS`)
- Bisa pilih tanggal lain untuk lihat historis

### US-3 — Reporting bulanan

> Sebagai owner, saya lihat performa warung per bulan supaya tahu pemasukan total dan menu mana yang paling laris.

**Acceptance:**
- Halaman `/reports/monthly` menampilkan: total pemasukan bulan ini, chart pemasukan per hari, top-5 menu terlaris
- Bisa navigate ke bulan-bulan sebelumnya

### US-4 — History transaksi

> Sebagai kasir/owner, saya bisa cari, lihat, edit, dan hapus transaksi lama.

**Acceptance:**
- List dengan filter date range + search by customer_name
- Tap → detail (sama layout dengan review screen, default read-only)
- Tombol Edit (buka editable mode) & Delete (soft delete)
- Soft-deleted >7 hari dihapus permanen oleh cron job (termasuk foto nota di Storage)

### US-5 — Menu master CRUD

> Sebagai owner, saya kelola list menu + harga supaya OCR akurat dan harga default benar.

**Acceptance:**
- List menu grouped per kategori (Makanan / Nasi / Minuman)
- Tambah, edit (nama/harga/kategori/sort_order), nonaktifkan (set `is_active=false`)
- Tidak ada hard delete (preserves FK ke transaksi historis)

## 3. Key decisions (dari brainstorming Q1-Q9)

| # | Topik | Keputusan | Implikasi |
|---|---|---|---|
| 1 | Device | Tablet primer + responsive HP | Tailwind breakpoints, layout dua-kolom di ≥md |
| 2 | Asal nota | Pre-printed form Pak Pon, tulisan tangan kasir di kolom qty + total | OCR sangat akurat dengan schema + enum menu reference |
| 3 | Anotasi ("D P", "Dada") | Catatan dapur → field `notes` di item, BUKAN variant menu | Schema simpel: nullable text |
| 4 | Pembayaran | TIDAK di-track | Tidak ada kolom `payment_method` |
| 5 | Cut-off harian | Midnight-to-midnight (23:59 WIB) | **Superseded** oleh `2026-06-21-shift-cutoff-design.md` — sekarang business-day berbasis env var |
| 6 | Harga menu | Snapshot per transaksi (`unit_price_snapshot`) | Transaksi historis aman saat menu master diubah |
| 7 | Handwritten total | OCR ekstrak juga → warning kalau ≠ sum items, sum items = source of truth | Field `handwritten_total` di transaction header |
| 8 | Akun login | 1 akun share via Supabase Auth email/password | No signup page, no user table tambahan |
| 9 | Retensi foto | Hapus barengan transaksi hard-delete (>7 hari setelah soft-delete) | Cron job hapus storage juga |
| 10 | Gemini model | `gemini-3.5-flash` (fallback `gemini-3.1-pro-preview` kalau Flash return kosong) | Latency 2-5 dtk, ~10-20× murah dari Pro |
| 11 | Compression | Client-side 1600px max + JPEG quality 0.8 | Library: `browser-image-compression` |
| 12 | OCR upload flow | All-server-mediated (FormData ke API route) | Simpel, 1 round-trip dari tablet |

## 4. Architecture

```
┌──────────────────────────────┐
│   Tablet / HP (Browser)      │
│   - kompres foto client-side │
└──────────────┬───────────────┘
               │
        HTTPS  │
               ▼
┌──────────────────────────────────────────┐
│   Vercel — Next.js 16 (App Router)        │
│                                           │
│   Pages              API Routes    Cron   │
│   /scan              POST /api/scan       │
│   /transactions      CRUD /api/tx  /api/  │
│   /menu              CRUD /api/menus cron │
│   /reports           GET /api/reports    │
└──────┬──────────────────────────┬─────────┘
       │                          │
       ▼                          ▼
┌──────────────────┐    ┌──────────────────┐
│   Supabase       │    │   Gemini API     │
│   - Auth         │    │   - 3.5-flash    │
│   - Postgres     │    │   - structured   │
│   - Storage      │    │     JSON output  │
│   (notas bucket) │    └──────────────────┘
└──────────────────┘
```

### Alur "scan nota" (happy path)

1. Kasir buka `/scan` → pilih/jepret foto nota
2. Browser compress foto (max 1600px, JPEG 0.8 quality)
3. POST `/api/scan` dengan FormData berisi image
4. Server:
   a. Upload foto ke Supabase Storage path `notas/<yyyy-mm>/<uuid>.jpg`
   b. Fetch menu master aktif → bangun enum nama menu untuk schema
   c. Call Gemini 3.5 Flash dengan image + menu reference + JSON schema
   d. Validate response server-side, lookup `menu_id` & `unit_price_snapshot` per item
   e. Insert `transactions` row (`status='pending_review'`) + `transaction_items`
   f. Return `transaction_id` + parsed items + mismatch flag
5. Browser redirect ke `/transactions/[id]/review`
6. Kasir edit/tambah/hapus item, klik "Konfirmasi"
7. PATCH `/api/transactions/[id]` dengan items final → server set `status='confirmed'`, `confirmed_at=now()`
8. Redirect ke `/transactions` atau `/scan` untuk nota berikutnya

### Error handling

| Skenario | Behavior |
|---|---|
| Foto blur / Gemini Flash bingung (items=[] atau total=0) | Server retry sekali dengan `gemini-3.1-pro-preview` |
| Pro juga gagal | Tetap insert draft dengan items=[] → kasir input manual via "+ Tambah item" |
| Gemini timeout (>20s) | Return 504 → client kasih retry button (foto sudah ke-upload, kirim ulang job dengan path foto saja) |
| Item OCR pakai menu yang `is_active=false` | Validasi server skip item itu, masuk warning → kasir input manual |
| Upload Storage gagal | Return 500, client retry penuh |

## 5. Data model

Semua money sebagai **`bigint` rupiah** (tanpa sen). Jangan pakai `float`/`numeric` untuk uang.

### Table: `menus`

| kolom | type | nullable | catatan |
|---|---|---|---|
| `id` | uuid PK | NO | `default gen_random_uuid()` |
| `name` | text | NO | "Pecel Lele", "Ayam goreng", dst |
| `category` | text | NO | `'makanan' \| 'nasi' \| 'minuman'` (check constraint) |
| `price` | bigint | NO | rupiah |
| `sort_order` | int | NO | default 0 |
| `is_active` | bool | NO | default true |
| `created_at` | timestamptz | NO | default `now()` |
| `updated_at` | timestamptz | NO | default `now()` (trigger update) |

### Table: `transactions`

| kolom | type | nullable | catatan |
|---|---|---|---|
| `id` | uuid PK | NO | |
| `scan_image_path` | text | YES | path di Storage; NULL untuk transaksi manual full |
| `handwritten_total` | bigint | YES | hasil OCR total tulisan tangan; NULL untuk transaksi manual |
| `status` | text | NO | `'pending_review' \| 'confirmed'` (check constraint) |
| `customer_name` | text | YES | dari kolom "Nama" di nota |
| `table_no` | text | YES | dari kolom "No. Meja" |
| `created_at` | timestamptz | NO | waktu scan; basis report harian/bulanan |
| `confirmed_at` | timestamptz | YES | waktu kasir klik konfirmasi |
| `deleted_at` | timestamptz | YES | soft delete; cron hapus permanen >7 hari |
| `updated_at` | timestamptz | NO | |

### Table: `transaction_items`

| kolom | type | nullable | catatan |
|---|---|---|---|
| `id` | uuid PK | NO | |
| `transaction_id` | uuid FK → transactions ON DELETE CASCADE | NO | |
| `menu_id` | uuid FK → menus | YES | NULL kalau menu master sudah dihapus permanen (tidak mungkin saat ini karena cuma soft via `is_active`) |
| `menu_name_snapshot` | text | NO | preserved kalau menu di-nonaktifkan |
| `unit_price_snapshot` | bigint | NO | snapshot harga saat transaksi |
| `qty` | int | NO | check `qty > 0` |
| `notes` | text | YES | "D P", "Dada", dst |
| `sort_order` | int | NO | default 0 |

### Indexes

- `transactions(created_at DESC)` — report queries
- `transactions(deleted_at) WHERE deleted_at IS NOT NULL` — cron cleanup
- `transactions(status)` — review queue filter (kecil tapi sering)
- `transaction_items(menu_id)` — top items aggregation
- `transaction_items(transaction_id)` — auto from FK

### RLS policies

```sql
-- Semua tabel: authenticated boleh ALL, anon DENY
CREATE POLICY auth_all ON menus
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- (sama untuk transactions, transaction_items)
```

### Storage

- **Bucket**: `notas`, private
- **Path convention**: `notas/<yyyy>-<mm>/<transaction_id>.jpg`
- **Access**: server-side pakai service-role key untuk upload/delete; client lihat via signed URL (1 jam expiry) yang di-generate server saat `GET /api/transactions/[id]`

### Seed data

Migration `0002_seed_menus.sql` import menu dari nota tercetak Pak Pon:

- **Makanan**: Pecel Lele (16k), Ayam goreng (19k), Ayam bakar (19k), Ayam Kampung goreng (30k), Ayam Kampung bakar (30k), Bebek goreng (38k), Bebek bakar (38k), Sop Ayam (30k), Sop Sapi (35k), Burung Dara goreng (38k), Burung Dara bakar (38k), Nila goreng (38k), Nila bakar (38k)
- **Nasi**: Nasi (7k), Tahu Tempe (8k), Pete Goreng (10k), Terong (7k), Kol Goreng (5k), Sambel Tambahan (3k)
- **Minuman**: Es Teh (6k), Teh Panas (5k), Teh Panas Tawar (2k), Es Teh Tawar (3k), Es Jeruk (10k), Jeruk Panas (8k), Es Tawar (3k), Es Batu (5k), Mineral Botol (5k), Teh Botol Sosro (7k)

(Final list & sort_order di-verify saat seed migration ditulis.)

## 6. Screens & flows

### Routes

```
/login                              — public
/                                   — auth: Home / dashboard
/scan                               — auth: ambil/upload foto
/transactions                       — auth: history list
/transactions/[id]                  — auth: detail (view + edit + delete)
/transactions/[id]/review           — auth: review hasil OCR
/menu                               — auth: CRUD menu master
/reports                            — auth: tabs landing
/reports/daily                      — auth: angka closingan
/reports/monthly                    — auth: chart + top items
```

### Home (`/`)

4 tombol besar (Scan, History, Reports, Menu) + ringkasan hari ini di footer ("Hari ini: Rp 1.245.000 • 24 nota").

### Scan (`/scan`)

- Tombol "📸 Buka Kamera" (`<input type="file" accept="image/*" capture="environment">`)
- Tombol "🖼️ Pilih File"
- Setelah pilih: preview thumb → auto-compress → auto-upload → spinner OCR ~5-15 dtk → redirect ke review

### Review (`/transactions/[id]/review`)

- Header: thumbnail foto + tanggal + warning banner (kalau mismatch)
- Tabel items: kolom Menu, Qty, Subtotal, [✏️ 🗑️]
- Tap row / ✏️ → modal edit (menu picker dengan search, qty stepper, notes, tombol hapus)
- Tombol "+ Tambah item" buka modal yang sama
- Hapus → strikethrough sementara dengan link "undo" sebelum hilang permanen dari list
- Footer: Total sistem (auto-update), tombol "Batal" + "✓ Konfirmasi"

### History (`/transactions`)

- Filter date range + search by customer_name
- List card per transaksi (tanggal+jam, total sistem, status badge, customer_name kalau ada)
- Tap → detail

### Detail (`/transactions/[id]`)

- Sama layout dengan review, default **read-only**
- Tombol "Edit" → switch ke editable (same UX dengan review)
- Tombol "Hapus" (icon delete dengan confirmation modal)

### Menu master (`/menu`)

- 3 section per kategori (Makanan / Nasi / Minuman)
- Per row: nama, harga, sort_order (drag handle), toggle `is_active`, tombol edit
- Tombol "+ Menu Baru" di tiap section

### Reports

- `/reports/daily?date=YYYY-MM-DD` (default today): besar di tengah `Rp 1.245.000` + jumlah transaksi + date picker
- `/reports/monthly?ym=YYYY-MM` (default current month): total bulan, bar chart pemasukan per hari, top-5 menu terlaris (qty + revenue)

## 7. API contract

```
POST   /api/scan
       FormData: image (File)
       → 200 { transaction_id, items[], handwritten_total, mismatch: boolean }
       → 504 { error: "ocr_timeout" }

GET    /api/transactions?date_from=&date_to=&q=&status=
       → 200 { items: [{id, created_at, total, status, customer_name, item_count}, ...] }

GET    /api/transactions/[id]
       → 200 { transaction: {...}, items: [...], scan_url: <signed-url> }

PATCH  /api/transactions/[id]
       body: { status?, customer_name?, table_no?, items: [Item, ...] }
       Item: { id? (existing item uuid), menu_id, qty, notes?, sort_order? }
       Server replaces items strategy:
         - Item dengan `id` cocok existing → reuse `unit_price_snapshot` lama (PRESERVE)
         - Item baru (no `id`) → snapshot harga sekarang dari menus.price
         - Existing item yang tidak ada di body → hapus
       Status: 'pending_review' → 'confirmed' set confirmed_at=now().
       Status 'confirmed' yang di-PATCH untuk edit tetap 'confirmed'.
       → 200 { transaction, items }

DELETE /api/transactions/[id]
       → set deleted_at=now()
       → 200 { ok: true }

GET    /api/menus
       → 200 { items: [...] }  // includes inactive when ?include_inactive=1

POST   /api/menus
       body: { name, category, price, sort_order? }
       → 201 { menu }

PATCH  /api/menus/[id]
       body: partial fields
       → 200 { menu }

DELETE /api/menus/[id]
       → set is_active=false
       → 200 { ok: true }

GET    /api/reports/daily?date=YYYY-MM-DD
       → 200 { date, total, count, top_items: [{menu_name, qty, revenue}] }

GET    /api/reports/monthly?ym=YYYY-MM
       → 200 { month, total, count, daily: [{date, total, count}], top_items: [...] }

POST   /api/cron/cleanup
       Headers: Authorization: Bearer <CRON_SECRET>
       → hard delete transactions WHERE deleted_at < now() - interval '7 days'
       → delete associated Storage objects
       → 200 { deleted_count }
```

Semua route: validate input dengan Zod, check auth via `createServerClient(cookies())`, return 401 kalau guest.

## 8. OCR strategy (Gemini)

### Model selection

- **Primary**: `gemini-3.5-flash` (latency 2-5s, low cost, supports structured JSON via responseSchema)
- **Fallback**: `gemini-3.1-pro-preview` — dipanggil sekali kalau Flash return `items=[]` atau `handwritten_total=0`

### Why Flash is sufficient

1. Nota pre-printed → layout konsisten → ambiguitas rendah
2. Schema dengan **enum nama menu** dari master → memaksa Gemini pilih dari list valid (no hallucination)
3. Task: baca printed text + simple handwritten digits → bukan reasoning kompleks
4. `thinking_level: 'minimal'` cocok untuk OCR

### System prompt (sketsa)

> Anda OCR untuk nota warung Pecel Lele Pak Pon. Format nota: kolom MENU sudah pre-printed dengan harga, kasir tulis tangan angka di kolom "Banyak nya" dan total di bawah. Ekstrak hanya item dengan angka qty yang ditulis tangan di sebelahnya. Anotasi tulisan tangan di sebelah nama menu (cth: "D P", "Dada") masuk ke field `notes`. `handwritten_total` = angka total yang ditulis di bawah nota (kalau ada). Gunakan nama menu persis seperti daftar master di bawah.

Diikuti list menu master sebagai context, dan inline image part.

### Implementation sketch (`lib/gemini.ts`)

```ts
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

const client = new GoogleGenAI({});

export async function scanNota(base64Image: string, menus: Menu[]) {
  const menuNames = menus.map(m => m.name);
  const ScanResult = z.object({
    items: z.array(z.object({
      menu_name: z.enum(menuNames as [string, ...string[]]),
      qty: z.number().int().positive(),
      notes: z.string().nullable(),
    })),
    handwritten_total: z.number().int().nonnegative(),
    customer_name: z.string().nullable(),
    table_no: z.string().nullable(),
  });

  const callModel = (model: string) => client.interactions.create({
    model,
    input: [
      { type: 'text', text: SYSTEM_PROMPT + buildMenuRefText(menus) },
      { type: 'image', data: base64Image, mime_type: 'image/jpeg' },
    ],
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: z.toJSONSchema(ScanResult),
    },
    generation_config: { thinking_level: 'minimal' },
  });

  let result = await callModel('gemini-3.5-flash');
  let parsed = ScanResult.parse(JSON.parse(result.output_text));

  // Fallback ke Pro kalau Flash gagal
  if (parsed.items.length === 0 || parsed.handwritten_total === 0) {
    result = await callModel('gemini-3.1-pro-preview');
    parsed = ScanResult.parse(JSON.parse(result.output_text));
  }

  return parsed;
}
```

(API exact-syntax di-verify saat implement; check `@google/genai` docs latest.)

## 9. Auth

- **Library**: `@supabase/ssr` + `@supabase/supabase-js`
- **Flow**: email/password via Supabase Auth → cookies di-set via `@supabase/ssr` server client
- **Middleware** (`middleware.ts`): check session di semua routes kecuali `/login`; redirect kalau unauth
- **API routes**: gunakan `createServerClient(cookies())` per request, return 401 kalau no session
- **Akun**: dibuat **1x** lewat Supabase Dashboard (Auth → Add User). Tidak ada signup public.
- **Forgot password**: di luar MVP. Reset via Supabase Dashboard kalau perlu.

## 10. Compression

Client-side, sebelum upload. Library: `browser-image-compression`.

```ts
import imageCompression from 'browser-image-compression';

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

## 11. Deployment

### Env vars

| Variable | Lokasi | Buat apa |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client+server | project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | client+server | publishable key |
| `NEXT_PUBLIC_BUSINESS_DAY_CUTOFF_HOURS` | client+server | jam cut-off business-day (default 12) |
| `SUPABASE_SECRET_KEY` | server-only | service-role untuk cron (bypass RLS) |
| `GEMINI_API_KEY` | server-only | Gemini API key |
| `CRON_SECRET` | server-only | random string, validate `Authorization` header dari Vercel Cron |

Local: `.env.local` (sudah di-gitignore). Production: `vercel env add`.

### `vercel.ts`

```ts
import { type VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  framework: 'nextjs',
  regions: ['sin1'],
  crons: [
    { path: '/api/cron/cleanup', schedule: '0 2 * * *' }, // 02:00 WIB harian
  ],
  functions: {
    'app/api/scan/route.ts': { maxDuration: 60 },
  },
};
```

### Initial setup (1-time)

1. Buat Supabase project
2. Run migrations: `0001_schema.sql` (tables + RLS + storage bucket) + `0002_seed_menus.sql`
3. Buat akun via Supabase Dashboard → Auth → Add User (set email + password)
4. Set env vars di local & Vercel
5. Deploy: `vercel deploy`

## 12. Cron cleanup

Daily 02:00 WIB. `/api/cron/cleanup` (POST):

1. Verify `Authorization: Bearer <CRON_SECRET>` header
2. Use service-role Supabase client (bypass RLS)
3. Query: `SELECT id, scan_image_path FROM transactions WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '7 days'`
4. For each: delete Storage object at `scan_image_path` (kalau ada)
5. `DELETE FROM transactions WHERE id = ANY($1)` (CASCADE auto-cleanup `transaction_items`)
6. Return `{ deleted_count: n }`

## 13. Project structure

```
pak-pon/
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (app)/
│   │   ├── layout.tsx              # auth-gated layout + nav
│   │   ├── page.tsx                # Home
│   │   ├── scan/page.tsx
│   │   ├── transactions/
│   │   │   ├── page.tsx
│   │   │   └── [id]/
│   │   │       ├── page.tsx
│   │   │       └── review/page.tsx
│   │   ├── menu/page.tsx
│   │   └── reports/
│   │       ├── page.tsx
│   │       ├── daily/page.tsx
│   │       └── monthly/page.tsx
│   ├── api/
│   │   ├── scan/route.ts
│   │   ├── transactions/{route.ts, [id]/route.ts}
│   │   ├── menus/{route.ts, [id]/route.ts}
│   │   ├── reports/{daily/route.ts, monthly/route.ts}
│   │   └── cron/cleanup/route.ts
│   ├── layout.tsx
│   └── globals.css
├── lib/
│   ├── supabase/{server.ts, client.ts, admin.ts}
│   ├── gemini.ts
│   ├── prompts.ts
│   ├── compress.ts
│   ├── currency.ts
│   └── date.ts
├── components/
│   ├── ui/                         # button, input, modal primitives
│   ├── nav.tsx
│   ├── nota-item-row.tsx
│   ├── nota-item-modal.tsx
│   ├── nota-review-form.tsx
│   ├── menu-form.tsx
│   ├── photo-uploader.tsx
│   └── reports/{daily-summary.tsx, monthly-chart.tsx}
├── middleware.ts
├── vercel.ts
├── supabase/migrations/
│   ├── 0001_schema.sql
│   └── 0002_seed_menus.sql
├── docs/
│   ├── brief.md
│   ├── spec.md
│   └── tasks.md
└── CLAUDE.md
```

## 14. Conventions

- **Money**: `bigint` rupiah; format dengan `formatRp()` dari `lib/currency.ts` → "Rp 120.000"
- **Timezone**: Asia/Jakarta (WIB) untuk semua date display + cut-off harian
- **Validation**: Zod di semua API route boundaries (input + output)
- **Schema source of truth**: `supabase/migrations/*.sql`
- **Next.js 16**: konsultasi `node_modules/next/dist/docs/01-app/` sebelum menulis route handler/middleware (banyak breaking changes vs versi sebelumnya)
- **Image**: client compress dulu (`lib/compress.ts`) sebelum upload
- **Auth**: pages dalam `app/(app)/` harus auth; `app/(auth)/` public
- **Soft delete (transactions)**: gunakan `deleted_at` timestamp; filter `WHERE deleted_at IS NULL` di semua query default; cron cleanup hapus permanen >7 hari
- **Soft delete (menus)**: gunakan `is_active=false` (permanent, tidak ada cleanup) — preserve FK ke transaksi historis
- **Currency display**: `formatRp(120000)` → `"Rp 120.000"` (dengan space + titik separator ribuan)
- **Business day**: pakai `currentBusinessDate()` / `businessDayRange()` dari `lib/date.ts`; jangan inline `created_at::date`

## 15. Out of scope (MVP)

Hal-hal berikut **sengaja tidak masuk MVP**, di-defer ke fase berikutnya kalau muncul kebutuhan:

- Payment method tracking (decision Q4)
- Tax / service charge / discount
- Menu variants dengan harga berbeda (Q3)
- Multi-user with audit trail (Q8)
- Per-user role/permission (1 role)
- Signup public + forgot password UI
- Owner vs kasir dashboard separation
- Print struk / nota digital
- Pelanggan database / loyalty
- Inventory / stock management
- Notifikasi push / email
- Export CSV/Excel report

## 16. Open implementation details (decided saat coding)

- Library chart bulanan: candidate `recharts` (default), `@tremor/react`, atau `chart.js`. Finalkan saat implement reports.
- UI primitives: tulis sendiri (button, input, modal) vs Shadcn vs Radix. Default: minimal manual primitives di `components/ui/` mengikuti Tailwind v4.
- Toast notifications: Sonner atau bikin sendiri.
- Date picker: `react-day-picker` atau native `<input type="date">`.
- Form library: react-hook-form vs native FormData + Zod. Default: native + Zod untuk minimalisme.

Keputusan-keputusan ini di-finalkan di implementation plan / saat coding, bukan blocking spec ini.
