# Nota Customer Otomatis untuk Pesanan Bungkus — Design Spec

**Tanggal:** 2026-08-07
**Status:** Implemented 2026-08-07, pending manual browser verification — plan: `docs/superpowers/plans/2026-08-07-takeaway-auto-customer-receipt.md`

## Masalah

Nota customer tidak pernah tercetak otomatis. Satu-satunya cara mencetaknya adalah tombol "🧾 Cetak nota customer" di halaman detail transaksi (`components/reprint-card.tsx`), yang berarti kasir harus: buka riwayat → buka transaksi → gulir ke kartu Cetak → tekan tombol.

Untuk pesanan **bungkus** itu bermasalah. Pesanan bungkus dibawa pergi; notanya harus ikut, dan harus ada sebelum pelanggan berjalan keluar. Sekarang kasir harus mengingat untuk menempuh empat langkah itu di saat paling sibuk.

Untuk pesanan makan di tempat tidak ada masalah — notanya diminta belakangan saat mau bayar, dan tombol manualnya sudah cukup.

## Aturan

Nota customer tercetak otomatis **saat transaksi bungkus pertama kali berpindah ke status `confirmed`**, bersamaan dengan tiket dapur. Isinya seluruh item transaksi, bukan hanya item yang baru.

Dua jalur yang memenuhi itu:
- Simpan di `/pos` (`POST /api/pos` selalu membuat transaksi `confirmed` baru)
- Simpan di `/transactions/[id]/review` saat transaksi masih `pending_review` (hasil OCR yang dikonfirmasi) — yaitu `wasConfirmedBefore === false`

`/monitor` tidak terlibat sama sekali: monitor menyaring `is_takeaway = false`, jadi transaksi bungkus tidak pernah muncul di sana.

### Konsekuensi yang disadari

**Edit setelah confirmed tidak mencetak ulang.** Kalau pesanan bungkus yang sudah confirmed ditambah itemnya, totalnya berubah dan nota yang sudah tercetak jadi salah — tapi tidak ada nota baru yang keluar otomatis. Kasir harus menekan tombol cetak manual di halaman detail.

**Toggle bungkus belakangan tidak mencetak.** Kalau transaksi dine-in yang sudah confirmed diedit lalu di-toggle jadi bungkus, momen "pertama kali confirmed" sudah lewat, jadi tidak ada cetak otomatis. Juga harus manual.

Keduanya konsekuensi langsung dari memilih aturan paling sederhana. Alternatifnya (cetak ulang tiap edit, atau menanyakan lewat modal) ditolak: boros kertas dan menambah keputusan di saat sibuk, untuk kasus yang jarang — pesanan bungkus umumnya dibayar dan dibawa pergi dalam hitungan menit.

## Arsitektur

### `lib/print-dispatch.ts` — helper baru

```ts
export async function dispatchCustomerReceiptJob(args: {
  tx: PrintJobTx;
  items: PrintJobItem[];
  printerSettings: PrinterSettings;
}): Promise<{ ok: boolean; offline: boolean }>;
```

Bersebelahan dengan `dispatchKitchenPrintJob` yang sudah ada, dan mengikuti bentuknya persis: render → `POST /api/print/send` → `{ ok, offline }` dengan `offline = true` pada HTTP 503.

Bedanya dari versi dapur, dan keduanya penting:

- Merender `renderCustomerReceipt` (bukan `renderKitchenTicket`).
- Mengirim `target: 'customer'`, `trigger: 'customer'`, dan **`item_ids: null`**.

**`item_ids: null` bukan detail sepele.** Trigger database `mark_items_printed_history` (migrasi 0016) hanya menyala kalau `item_ids` terisi. Kalau nota customer mengirim daftar id, item-itemnya akan ditandai sudah tercetak ke dapur — tombol "Cetak tambahan" mati padahal dapur belum menerima apa pun. Perilaku `null` ini sudah benar di `reprint-card.tsx` hari ini dan harus terbawa.

**Tidak perlu migrasi.** `print_history.trigger` sudah mengizinkan `'customer'` dan `print_history.target` sudah mengizinkan `'customer'` sejak migrasi 0018.

Nota customer otomatis dan nota cetak-ulang manual sama-sama tercatat sebagai `trigger='customer'`; keduanya tidak dibedakan di `print_history`. Disengaja — `print_history` dibersihkan cron setelah 7 hari dan tidak dipakai untuk audit keuangan, jadi memisahkannya (butuh migrasi CHECK constraint) tidak sepadan.

### Konsumen

**`components/pos/pos-client.tsx`** — di `handleSave`, setelah 201, kalau `isTakeaway` maka tambahkan satu job lagi ke `Promise.all` yang sudah ada, memakai **seluruh** `cartWithIds`.

**`components/nota-review-form.tsx`** — di `submitSave`, kalau `!wasConfirmedBefore && data.transaction.is_takeaway`, tambahkan satu job ke `Promise.all` yang sudah ada, memakai **seluruh** `itemsForQueue` — bukan hasil `buildJob`, yang sengaja menyaring per `printed_*_at` untuk delta dapur. Nota customer selalu utuh.

**`components/reprint-card.tsx`** — `fireCustomer` memanggil helper bersama; cabang `customer` dihapus dari `submitJob` lokalnya, yang setelah itu hanya melayani target dapur/minuman.

### Menyatukan jalur cetak ulang

Sekarang `reprint-card.tsx` menyusun nota customer sendiri (baris 47-64). Susunannya **tidak menyertakan `applied_chips`** (baris 53-58 hanya qty/name/unit_price/note), sehingga nota hasil cetak ulang kehilangan baris chip berbayar. Totalnya tetap benar karena harga chip sudah menyatu di `unit_price_snapshot`; yang hilang hanya keterangan barisnya. Ini bug lama, bukan akibat pekerjaan ini, dan dampaknya nol pada data produksi sekarang — satu-satunya chip yang ada semuanya `price_delta = 0`, dan `renderCustomerReceipt` memang hanya menampilkan chip dengan delta > 0.

Menyatukannya menghapus bug itu sekaligus menjamin nota otomatis dan nota cetak-ulang selalu identik. Ongkosnya merangkai `applied_chips` lewat empat tempat yang sekarang belum membawanya:

1. `app/(app)/transactions/[id]/page.tsx:29` — tambahkan `applied_chips` ke `select()` item
2. `components/transaction-detail.tsx` — tambahkan ke tipe `Item` dan teruskan ke `ReprintCard`
3. `components/reprint-card.tsx` — tambahkan ke `TransactionItemForPrint`
4. `fireCustomer` meneruskannya ke helper bersama

Job dapur/minuman di kartu itu tidak berubah.

## Penanganan gagal

Nota customer dikirim **berbarengan** dengan tiket dapur di `Promise.all` yang sudah ada, bukan berurutan. Konsekuensinya: kegagalan nota customer tidak menghalangi tiket dapur, dan sebaliknya.

Pesan ke kasir harus menyebut **target mana** yang gagal, supaya kasir tahu apa yang perlu diulang — mencetak ulang tiket dapur yang sudah keluar berarti dapur memasak dua kali. Pola toast yang sudah ada di kedua file (`failed.map((f) => f.target).join(', ')`) sudah melakukan ini; `'customer'` cukup ikut sebagai salah satu target.

Agent printer offline (503) tetap memunculkan peringatan kuning yang sudah ada, tanpa cabang baru.

## Testing

`lib/print-dispatch.test.ts` (sudah ada, berisi test `splitItemsByPrintTarget`) ditambah test untuk `dispatchCustomerReceiptJob` dengan `fetch` di-stub:

- Body yang dikirim punya `target: 'customer'`, `trigger: 'customer'`, dan **`item_ids: null`** — ini penjaga utama terhadap regresi trigger flag dapur
- `bytes_b64` tidak kosong
- HTTP 503 → `{ ok: false, offline: true }`
- HTTP 500 → `{ ok: false, offline: false }`
- `fetch` melempar → `{ ok: false, offline: false }`, tidak melempar keluar

Perilaku "kapan dicetak" (bungkus + pertama kali confirmed) hidup di dalam komponen React dan **belum** ditulis testnya. Harness-nya sudah tersedia (`@testing-library/react` + jsdom + `vitest.setup.ts`; contoh pemakaian di `components/reprint-card.test.tsx`), jadi ini utang yang bisa dilunasi kapan saja — bukan hal yang mustahil dites. Sementara ini dibuktikan lewat verifikasi manual di bawah.

## Verifikasi manual

1. `/pos`: buat pesanan **bungkus** → Simpan. Keluar tiket dapur **dan** nota customer, tanpa menyentuh tombol apa pun.
2. `/pos`: buat pesanan **dine-in** → Simpan. Hanya tiket dapur. Nota customer **tidak** keluar.
3. Review nota OCR bungkus → Simpan & Cetak. Tiket dapur + nota customer keluar, nota berisi seluruh item.
4. Edit transaksi bungkus yang sudah confirmed, tambah 1 item → Simpan. Hanya tiket dapur tambahan yang keluar; nota customer **tidak** ikut (sesuai aturan).
5. Setelah langkah 4, tekan "🧾 Cetak nota customer" di halaman detail → nota keluar dengan total baru yang benar.
6. Matikan agent printer, ulangi langkah 1 → transaksi tetap tersimpan, toast menyebut target yang gagal.
7. Tombol "Cetak tambahan" di halaman detail **tetap aktif** setelah nota customer tercetak — bukti `item_ids: null` bekerja dan trigger dapur tidak ikut menyala.
8. Cetak ulang nota customer dari halaman detail untuk transaksi yang sama → isinya identik dengan nota otomatis.

## File yang disentuh

| File | Status |
|---|---|
| `lib/print-dispatch.ts` | + `dispatchCustomerReceiptJob` |
| `lib/print-dispatch.test.ts` | + test helper baru |
| `components/pos/pos-client.tsx` | dispatch nota customer kalau bungkus |
| `components/nota-review-form.tsx` | dispatch nota customer kalau bungkus + first confirm |
| `components/reprint-card.tsx` | `fireCustomer` pakai helper bersama, cabang customer lokal dihapus |
| `components/transaction-detail.tsx` | teruskan `applied_chips` |
| `app/(app)/transactions/[id]/page.tsx` | ambil `applied_chips` |
| `lib/escpos.ts` | tidak diubah |
| API routes & migrasi | tidak diubah |

## Non-goals (YAGNI)

- Cetak ulang otomatis saat transaksi bungkus diedit setelah confirmed
- Cetak otomatis untuk transaksi dine-in
- Membedakan nota customer otomatis vs manual di `print_history`
- Tombol cetak nota customer dari card `/monitor` (monitor tidak menampilkan bungkus)
- Setelan owner untuk menyalakan/mematikan perilaku ini — kalau nanti dibutuhkan, itu fitur terpisah
- Mengubah isi atau tata letak `renderCustomerReceipt`
