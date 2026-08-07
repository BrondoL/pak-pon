# Tambah Item Langsung dari Card Monitor — Design Spec

**Tanggal:** 2026-08-07
**Status:** Implemented 2026-08-07, pending manual browser verification — plan: `docs/superpowers/plans/2026-08-07-monitor-add-item.md`

## Masalah

Kasir sering perlu menambah pesanan ke meja yang sudah jalan ("tambah 2 es teh"). Flow sekarang panjang:

```
card monitor → tap card → MonitorDetailModal (read-only)
  → "Buka detail lengkap" → /transactions/[id]
  → Edit → /transactions/[id]/review (nota-review-form)
  → "+ Tambah item" → NotaItemModal → simpan → ulangi per item
```

Enam langkah sebelum item pertama masuk, dan pola "+ Tambah item" di `nota-review-form` menambahkan satu item per pembukaan modal.

## Tujuan

Dari card di `/monitor`, kasir bisa menambah **beberapa item sekaligus** lewat satu modal, lalu simpan **sekali** — tiket dapur untuk item baru langsung tercetak.

Bukan pengganti halaman edit transaksi. Modal ini **hanya menambah**; ubah/hapus item lama tetap lewat `/transactions/[id]/review`.

## Keputusan kunci (hasil brainstorm)

- **Titik masuk: tombol `+ Item` di card monitor.** Tap badan card tetap membuka `MonitorDetailModal` read-only seperti sekarang.
- **Modal tidak menampilkan item lama.** Cuma daftar item baru. Alasan: layar HP muat lebih banyak menu, dan modal jadi tidak perlu fetch apa pun saat dibuka.
- **Tap kartu menu → langsung masuk daftar dengan qty 1.** Bukan buka modal konfigurasi dulu (beda dari `/pos`). Chip/catatan lewat tombol ✏️ per baris. Ini poin utama: "2 es teh = 2 tap", bukan 4.
- **Simpan → langsung cetak, tanpa dialog konfirmasi.** Ini **konsisten dengan perilaku sekarang**, bukan perubahan: `nota-review-form.tsx:230` hanya memunculkan modal reprint kalau ada item **lama** yang diubah; menambah item saja sudah langsung cetak `auto_additional`. Karena modal ini tidak bisa mengubah item lama, kasus pemicu konfirmasi mustahil terjadi di sini.
- **Endpoint baru append-only**, bukan `PATCH` yang sudah ada. Alasan di bagian berikut.

## Kenapa endpoint baru, bukan `PATCH /api/transactions/[id]`

`replaceItems()` (`app/api/transactions/[id]/route.ts:272`) melakukan **delete semua + insert ulang**. Kalau dipakai untuk fitur ini, konsekuensinya:

1. Modal harus `GET` transaksi dulu untuk tahu item lama → ada spinner sebelum modal siap. Bertentangan dengan tujuan kecepatan.
2. **Read-modify-write race.** Client mengirim balik daftar item lama yang sudah basi. Kalau device lain menambah item di antara GET dan PATCH, item itu terhapus. Di warung dengan 2 HP kasir ini skenario nyata, bukan teoretis.
3. Hapus-insert-ulang seluruh baris cuma untuk menambah satu item.

Endpoint append-only menghilangkan ketiganya: server hanya `INSERT`, item lama tidak pernah tersentuh, dan `printed_dapur_at` / `printed_minuman_at` item lama dijamin utuh sehingga tiket dapur mustahil tercetak dobel.

Alternatif ketiga yang ditolak: halaman penuh `/pos?tambah=<id>`. Kasir keluar dari monitor (owner minta langsung dari card), dan `PosClient` membawa form nama/meja/bungkus yang tidak relevan saat menambah item.

## API — `POST /api/transactions/[id]/items`

File baru `app/api/transactions/[id]/items/route.ts`.

**Request:**

```jsonc
{
  "items": [
    { "menu_id": "uuid", "qty": 2, "notes": null, "chip_labels": ["Panas"] }
  ]
}
```

Zod di boundary: `items` min 1 max 50; `qty` int positif; `chip_labels` array string (min 1, max 40 char) maksimal 20 elemen, default `[]`; `.strict()`.

**Client mengirim `chip_labels`, bukan harga.** Harga dihitung server dari master menu + `price_delta` chip — pola sama seperti `POST /api/pos`, mencegah tampering.

**Alur handler:**

1. Auth → 401 kalau tidak ada user
2. Ambil transaksi `.eq('id', id).is('deleted_at', null).single()` → 404
3. Tolak kalau `status !== 'confirmed'` → 409 `{ error: 'not_confirmed' }`. Monitor memang hanya menampilkan `confirmed`; 409 menangkap kasus transaksi berubah status dari device lain.
4. Ambil `menus (id, name, price)` + `fetchChipsByMenu(supabase, menuIds)` — hanya untuk `menu_id` yang dikirim
5. Per item: `validateChipMutex()` → `buildAppliedChipsSnapshot()` → gagal = 400 `chip_validation_failed`
6. `sort_order` lanjut dari nilai tertinggi item yang sudah ada di transaksi ini
7. `INSERT` baris baru, `.select()` supaya `id` hasil generate ikut kembali (dibutuhkan client untuk `item_ids` print job)
8. Return `{ transaction, items }`

**Kolom yang di-insert per baris:** `transaction_id`, `menu_id`, `menu_name_snapshot`, `unit_price_snapshot` (= `menu.price + Σ chip.price_delta`), `qty`, `notes`, `applied_chips`, `sort_order`, `confidence: null`, `printed_dapur_at: null`, `printed_minuman_at: null`.

`applied_chips` disnapshot beku sesuai konvensi yang ada — `mutex_group` sengaja tidak ikut disnapshot (cuma constraint saat input).

**Logging:** wide-event `try/catch/finally` sesuai `docs/logging.md`. Field: `tx_id`, `item_count`, `chip_count`, `has_free_notes`, `elapsed_ms`, plus `reject_reason` di jalur error.

## Helper murni — `lib/transactions.ts`

```ts
buildAppendItemRows(input: {
  requested: Array<{ menu_id, qty, notes, applied_chips }>;
  menus: MenuRef[];
  startSortOrder: number;
}): ItemRow[]
```

Menghitung `menu_name_snapshot`, `unit_price_snapshot`, dan `sort_order` berurutan dari `startSortOrder`. Throw kalau `menu_id` tidak dikenal. Tanpa akses DB → bisa dites langsung di Vitest.

## UI

### Card monitor (`components/monitor-board.tsx`)

Tombol `Lunas` yang sekarang full-width jadi sebaris berdua:

```
┌─ Card monitor ──────────────┐
│ Meja 5              19:04   │
│ Budi                        │
│ 4 item          Rp 84.000   │
│                             │
│ [  + Item  ] [   Lunas   ]  │
└─────────────────────────────┘
```

`+ Item` pakai `variant="secondary"`, `Lunas` tetap utama. Tap badan card tidak berubah.

`app/(app)/monitor/page.tsx` menambah fetch `menus` (beserta `chips`) + `getPrinterSettings()` — query persis seperti `app/(app)/pos/page.tsx:14-26` — lalu meneruskannya ke `MonitorBoard`. Konsekuensinya modal **tidak perlu fetch apa pun** saat dibuka: terbuka instan.

### `components/monitor-add-item-modal.tsx` (baru)

```
┌─ Tambah Item · Meja 5 ───────────────┐
│ [Cari menu…                        ] │
│ [🍛 Makanan][🍚 Nasi][🥤 Minuman]    │
│ ┌─────┐┌─────┐┌─────┐                │  ← area scroll
│ │Lele ││Ayam ││Nila │   grid menu    │
│ └─────┘└─────┘└─────┘                │
│ ┌─────┐┌─────┐┌─────┐                │
│ │Bawal││Tahu ││Tempe│                │
│ └─────┘└─────┘└─────┘                │
│ ──────────────────────────────────── │
│ Item baru:                           │  ← nempel di bawah
│   Lele Goreng  [− 1 +]  ✏️  🗑️        │
│   Es Jeruk     [− 2 +]  ✏️  🗑️        │
│ ──────────────────────────────────── │
│ [Batal]  [✓ Simpan & Cetak 34.000]   │
└──────────────────────────────────────┘
```

Judul: `Tambah Item · Meja 5`, fallback ke nama pelanggan kalau `table_no` kosong, fallback terakhir `Tambah Item`.

Komponen yang dipakai ulang **tanpa perubahan**:
- `components/pos/pos-menu-picker.tsx` — search + tab kategori + grid
- `components/pos/pos-item-config-modal.tsx` — dibuka lewat ✏️ (qty + chip + catatan)
- `components/chip-picker.tsx` — sudah dipakai di dalam config modal

**Aturan tap kartu menu:** kalau menu yang sama sudah ada di daftar draft **dan** baris itu belum punya chip maupun catatan → `qty += 1`. Kalau baris yang ada sudah punya chip (mis. "Es Teh — panas"), tap menu polos membuat baris baru terpisah. Aturan ini menjaga "tap berulang = tambah jumlah" tetap intuitif tanpa diam-diam menimpa konfigurasi yang sudah dibuat kasir.

**Layout HP:** grid menu yang scroll; daftar item baru + footer nempel di bawah modal supaya tombol Simpan selalu terlihat.

Tombol Simpan disabled saat daftar kosong atau sedang mengirim. Kunci `useRef` sinkron anti double-tap, pola sama `pos-client.tsx:52`.

## Cetak

Setelah 200, client memisahkan item baru per tujuan (`makanan`/`nasi` → `dapur`, `minuman` → `minuman`) lalu memanggil `dispatchKitchenPrintJob()` dengan `trigger: 'auto_additional'` dan `item_ids` = id item baru saja.

Tidak ada filter `printed_*_at` di sisi client seperti di `nota-review-form.tsx:315-317` — tidak perlu, karena response hanya berisi baris yang baru saja di-insert.

Toast mengikuti pola `pos-client.tsx:141-149`: sukses / peringatan agent offline / error kirim print.

## Setelah simpan

Modal tutup → `fetchRows()` dipanggil supaya card menampilkan `item_count` & total yang baru. Draft di-reset.

## Penanganan error

| Kejadian | Perilaku |
|---|---|
| Gagal simpan (jaringan/500) | Toast merah, **modal tetap terbuka, draft tidak hilang** — kasir tinggal coba lagi. Sengaja beda dari `/pos` yang redirect setelah sukses. |
| Simpan sukses, agent printer offline (503) | Modal tutup (data sudah masuk), toast kuning: "Agent printer offline. Nyalakan agent lalu cetak manual dari detail transaksi." |
| Transaksi keburu dihapus device lain (404) | Toast "Transaksi sudah tidak ada", modal tutup, `fetchRows()` |
| Transaksi keburu berubah status (409) | Toast "Transaksi sudah tidak aktif", modal tutup, `fetchRows()` |
| `chip_labels` tidak dikenal / melanggar mutex (400) | Toast error, modal tetap terbuka. Praktis mustahil dari UI; jaring pengaman kalau master menu diubah owner saat modal terbuka. |

Transaksi yang keburu ditandai **lunas** dari device lain tetap diterima (200) — `paid_at` tidak memblokir penambahan item. Kasir menandai lunas ulang setelah item baru masuk. Memblokirnya akan menghalangi kasus sah "sudah bayar, lalu pesan tambah".

## Testing (Vitest)

`lib/transactions.test.ts` — `buildAppendItemRows`:
- `sort_order` lanjut berurutan dari `startSortOrder`
- `unit_price_snapshot` = harga menu + total `price_delta` chip
- Tanpa chip → `unit_price_snapshot` = harga menu, `applied_chips` = `[]`
- `menu_id` tidak dikenal → throw
- `printed_dapur_at` / `printed_minuman_at` mulai `null`

Mutex chip sudah tercakup `lib/menu-chips.test.ts`.

Cek manual: tambah 2 item ke meja belum bayar → tiket dapur hanya berisi item baru, item lama tidak tercetak ulang, total di card naik.

## File yang disentuh

| File | Status |
|---|---|
| `app/api/transactions/[id]/items/route.ts` | baru |
| `components/monitor-add-item-modal.tsx` | baru |
| `components/monitor-board.tsx` | tombol `+ Item` + state modal |
| `app/(app)/monitor/page.tsx` | fetch + teruskan `menus` & `printerSettings` |
| `lib/transactions.ts` | tambah `buildAppendItemRows` |
| `lib/transactions.test.ts` | test helper baru |
| `components/pos/pos-menu-picker.tsx`, `components/pos/pos-item-config-modal.tsx` | dipakai ulang, **tidak diubah** |

Dua file terakhir ada di `components/pos/` tapi akan dipakai monitor juga. Sengaja **tidak dipindah**: memindah file melebarkan diff tanpa manfaat nyata sekarang. Kalau muncul pemakai ketiga, baru layak naik ke `components/`.

## Non-goals (YAGNI)

- Ubah/hapus item lama dari modal monitor — tetap lewat `/transactions/[id]/review`
- Ubah nama/meja/flag bungkus dari modal ini
- Cetak struk pelanggan dari modal ini
- Menampilkan item lama di dalam modal
- Undo "tambah item" setelah tersimpan — hapus item lewat halaman edit
