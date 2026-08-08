# Bungkus Masuk Monitor + Nota Customer Saat Ditandai Lunas — Design Spec

**Tanggal:** 2026-08-08
**Status:** Approved (brainstorm), pending implementation plan
**Menggantikan sebagian:** `docs/superpowers/specs/2026-08-07-takeaway-auto-customer-receipt-design.md` — aturan "cetak saat pertama kali confirmed" dicabut dan digantikan "cetak saat ditandai lunas". Helper dan jalur cetaknya tetap dipakai.

## Masalah

Dua hal yang saling berkaitan, keduanya ketahuan saat menyiapkan verifikasi manual:

**Pesanan bungkus tidak terlacak.** Monitor sengaja menyaring `is_takeaway = false`, jadi pesanan bungkus tidak pernah muncul. Akibatnya tidak ada tempat praktis untuk menandainya lunas — 708 dari 737 pesanan bungkus tercatat "belum bayar" selamanya, bukan karena belum dibayar tapi karena tidak ada yang pernah menandainya. Tidak ada kerugian uang (laporan mengabaikan `paid_at`), tapi kolomnya jadi tidak berarti untuk bungkus, dan kasir tidak punya papan untuk memantau pesanan bungkus yang sedang dimasak.

**Nota customer tercetak di waktu yang salah.** Aturan sebelumnya mencetak nota saat pesanan bungkus pertama kali `confirmed` — yaitu saat pesanan baru masuk, sebelum dimasak dan sebelum dibayar. Alur warung yang sebenarnya: pelanggan pesan bungkus → menunggu → pesanan jadi → bayar → pergi. Notanya seharusnya keluar di titik terakhir, bersamaan dengan serah terima.

## Aturan

Monitor menampilkan **semua** pesanan hari ini yang `confirmed` dan belum ditandai lunas — dine-in maupun bungkus. Kartu bungkus diberi badge pembeda.

Tombol "Lunas" membuka konfirmasi yang sudah ada, kini dengan dua pilihan aksi: **Lunas saja** dan **Lunas + nota**. Nota customer dicetak hanya lewat pilihan kedua.

Cetak otomatis saat simpan dicabut. Saat menyimpan, hanya tiket dapur/minuman yang keluar — untuk semua jenis pesanan.

### Yang dibatalkan dari keputusan sebelumnya

- **Cetak nota otomatis saat pertama kali confirmed** (`components/pos/pos-client.tsx`, `components/nota-review-form.tsx`). Kalau dibiarkan, satu pesanan bungkus mengeluarkan dua nota.
- **Rencana menandai pesanan bungkus otomatis lunas saat disimpan.** Justru kebalikannya sekarang: bungkus tetap belum bayar sampai kasir menekannya. Itu inti dari memasukkannya ke monitor.

`lib/print-dispatch.ts::dispatchCustomerReceiptJob` **tetap** — sekarang dipakai monitor dan tombol cetak ulang di halaman detail.

## Monitor

### Filter

Hapus `.eq('is_takeaway', false)` dari `fetchUnpaidRows` (`lib/monitor-server.ts`). Filter yang tersisa: `status='confirmed'` AND `paid_at IS NULL` AND `deleted_at IS NULL` AND `created_at ∈ businessDayRange(hari ini)`. Urutan tetap `created_at` asc.

`/api/monitor` memakai `fetchUnpaidRows` yang sama, jadi satu perubahan mengurus SSR awal dan polling 15 detik sekaligus.

Tambahkan `is_takeaway` ke `select()`, ke `MonitorRawRow`, ke `MonitorRow`, dan ke `mapMonitorRow` (`lib/monitor.ts`).

**Data lama tidak perlu di-backfill.** Monitor hanya menampilkan hari ini, jadi 708 baris bungkus lama tidak akan muncul.

### Kartu

Badge **BUNGKUS** di kartu bungkus, memakai token yang sudah ada (`gold-faint` / `gold-dark` / `gold`), sebaris dengan nomor meja. Kartu dine-in tidak berubah.

Tombol **+ Item** ikut tersedia di kartu bungkus — jatuh dengan sendirinya dan memang berguna (pelanggan menambah pesanan sambil menunggu).

### Teks halaman

Judul "Meja **belum bayar**" dan kondisi kosong "Semua meja sudah bayar 🎉" jadi tidak tepat karena bungkus bukan meja. Ganti jadi "Pesanan **belum bayar**" dan "Semua pesanan sudah bayar 🎉". Placeholder pencarian ("Cari meja atau nama…") tetap — mencari bungkus lewat nama pelanggan tetap masuk akal.

## Dialog konfirmasi lunas

Memakai `AlertDialog` yang sudah ada, tanpa dialog kedua — supaya tidak menambah ketukan.

```
┌──────────────────────────────────────────┐
│ Tandai Meja 5 lunas?                     │
│ Budi · Rp 84.000                         │
│ Transaksi akan hilang dari monitor.      │
│                                          │
│   [Batal] [Lunas saja] [Lunas + nota]    │
└──────────────────────────────────────────┘
```

`AlertDialogFooter` sudah `flex-col-reverse` di HP dan `flex-row` di `sm:` ke atas, jadi tiga tombol menumpuk vertikal di HP tanpa perubahan layout.

**Penekanan mengikuti jenis pesanan.** Kartu bungkus menyorot "Lunas + nota" sebagai tombol utama; kartu dine-in menyorot "Lunas saja". Keduanya tetap tersedia di kedua jenis — ini nudge, bukan pembatasan. Alasannya: pelanggan bungkus hampir selalu membawa notanya, pelanggan dine-in jarang meminta.

> ⚠️ `AlertDialogAction` di fork base-ui ini **bukan** `Close` — menekannya tidak menutup dialog. Yang menutup dialog hari ini adalah hilangnya baris dari daftar secara optimistic, yang meng-unmount dialognya. Perilaku itu harus dipertahankan; jangan menambahkan penutupan manual yang bisa bentrok dengannya.

## Alur "Lunas + nota"

Urutannya **tandai lunas dulu, baru cetak**. Kalau printer gagal, transaksinya tetap tercatat lunas dan kasir tinggal cetak ulang dari halaman detail. Kebalikannya lebih buruk: nota sudah di tangan pelanggan tapi status masih belum bayar.

1. Optimistic: baris dihapus dari papan (perilaku sekarang).
2. `PATCH /api/transactions/[id]` `{ paid: true }`. Gagal → rollback baris + toast merah, **berhenti** (tidak mencetak).
3. Toast sukses "ditandai lunas".
4. Kalau pilihan "Lunas + nota": `GET /api/transactions/[id]` untuk mengambil transaksi + item lengkap.
   - `GET` memakai `select('*')` dan `select('*, menus(category)')`, jadi `daily_seq` dan `applied_chips` — dua hal yang dibutuhkan renderer — sudah tersedia tanpa perubahan endpoint.
   - Gagal → toast "Sudah ditandai lunas, tapi gagal ambil data nota. Cetak manual dari detail transaksi."
5. `dispatchCustomerReceiptJob({ tx, items, printerSettings })`.
   - Sukses → toast "Nota customer dikirim ke agent".
   - `offline` → toast kuning "Agent printer offline. Nyalakan agent lalu cetak manual dari detail transaksi."
   - Gagal lain → toast merah, transaksi tetap lunas.

`printerSettings` sudah tersedia sebagai prop `MonitorBoard` (ditambahkan saat fitur tambah-item), jadi tidak ada plumbing baru.

**Penjaga ketuk ganda.** Dua ketukan cepat pada "Lunas + nota" sebelum React sempat re-render akan menjalankan alurnya dua kali → dua nota untuk satu pesanan. `PATCH`-nya idempoten jadi tidak berbahaya, tapi kertasnya terbuang dan pelanggan bingung. Pakai `useRef<Set<string>>` berisi id yang sedang diproses; id yang sudah ada di set langsung `return`.

## Yang dicabut dari kode

`components/pos/pos-client.tsx` dan `components/nota-review-form.tsx`: hapus blok yang mengirim `dispatchCustomerReceiptJob` saat transaksi bungkus pertama kali confirmed, beserta impor dan pelebaran tipe `DispatchTarget` kalau jadi tidak terpakai. Konstruksi job dapur/minuman dan seluruh cabang toast di kedua file **tidak** berubah.

## Testing

Repo ini **punya** harness test komponen — `@testing-library/react` + `user-event` + `jest-dom` + jsdom, di-wire lewat `vitest.setup.ts`, dengan tiga contoh pemakaian (`components/reprint-card.test.tsx` yang paling dekat). Jadi perilaku di bawah ditest, bukan diserahkan ke verifikasi manual.

**`lib/monitor.test.ts`** (sudah ada):
- `mapMonitorRow` membawa `is_takeaway` apa adanya

**`components/monitor-board.test.tsx`** (baru), dengan `fetch` di-stub:
- Kartu bungkus menampilkan badge BUNGKUS; kartu dine-in tidak
- "Lunas saja" → satu `PATCH` `{paid:true}`, **tidak ada** panggilan ke `/api/print/send`
- "Lunas + nota" → `PATCH` dulu, lalu `GET /api/transactions/[id]`, lalu `POST /api/print/send` dengan `target: 'customer'`
- `PATCH` gagal → baris kembali muncul, **tidak ada** panggilan cetak
- `GET` gagal setelah `PATCH` sukses → baris tetap hilang, toast peringatan, tidak melempar
- Ketuk ganda cepat pada "Lunas + nota" → hanya satu rangkaian panggilan

Test-test ini menutup persis kesalahan yang paling mungkin terjadi: mencetak padahal kasir memilih "Lunas saja", atau mencetak saat penandaan lunas gagal.

## Verifikasi manual

1. Buat pesanan **bungkus** dari `/pos` → hanya tiket dapur yang keluar, **tidak ada** nota customer.
2. Kartunya muncul di `/monitor` dengan badge BUNGKUS.
3. Tekan Lunas → pilih **Lunas + nota** → nota customer keluar, kartu hilang dari papan.
4. Pesanan dine-in → tekan Lunas → pilih **Lunas saja** → kartu hilang, **tidak ada** kertas keluar.
5. Matikan agent printer, ulangi langkah 3 → kartu tetap hilang (sudah lunas), muncul peringatan kuning.
6. Tombol **+ Item** di kartu bungkus berfungsi seperti di kartu dine-in.
7. Nota di langkah 3 isinya sama dengan hasil tombol "🧾 Cetak nota customer" di halaman detail.

## File yang disentuh

| File | Status |
|---|---|
| `lib/monitor-server.ts` | hapus filter `is_takeaway`, ambil kolomnya |
| `lib/monitor.ts` | `MonitorRow`/`MonitorRawRow`/`mapMonitorRow` bawa `is_takeaway` |
| `lib/monitor.test.ts` | test tambahan |
| `components/monitor-board.tsx` | badge, dialog 3 tombol, alur cetak, penjaga ketuk ganda |
| `components/monitor-board.test.tsx` | baru |
| `app/(app)/monitor/page.tsx` | teks judul |
| `components/pos/pos-client.tsx` | cabut cetak-otomatis |
| `components/nota-review-form.tsx` | cabut cetak-otomatis |
| `CLAUDE.md` | bullet "Nota customer otomatis untuk bungkus" memuat aturan lama — harus ditulis ulang |
| `docs/superpowers/specs/2026-08-07-takeaway-auto-customer-receipt-design.md` | tandai bagian aturannya sebagai digantikan spec ini |
| `lib/print-dispatch.ts` | tidak diubah |
| API routes & migrasi | tidak diubah |

⚠️ Dua baris dokumentasi terakhir itu bukan formalitas. `CLAUDE.md` adalah rujukan yang dibaca lebih dulu di sesi berikutnya; kalau masih menyatakan "nota tercetak saat pertama kali confirmed", perubahan ini akan dibatalkan tanpa sengaja oleh pekerjaan berikutnya.

## Non-goals (YAGNI)

- Backfill 708 pesanan bungkus lama
- Memisahkan tab/filter bungkus vs dine-in di monitor — badge sudah cukup
- Mengubah urutan papan supaya bungkus di atas
- Menandai bungkus otomatis lunas
- Mengubah isi atau tata letak `renderCustomerReceipt`
- Setelan owner untuk menyalakan/mematikan cetak saat lunas
