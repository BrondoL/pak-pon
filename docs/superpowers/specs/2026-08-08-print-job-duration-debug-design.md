# Durasi Job Cetak di Halaman Debug — Design Spec

**Tanggal:** 2026-08-08
**Status:** Draft
**Terkait:** migrasi `0039_print_history_printing_at.sql` (kolom yang dibaca fitur ini)

## Masalah

Owner melapor nota customer lama keluar. Menyelidikinya butuh SQL langsung ke Supabase — padahal sudah ada halaman bernama **Printer Diagnostic** (`/setup/printer/debug`) yang justru tidak bisa menjawabnya: durasi job tidak ditampilkan sama sekali.

Yang menyakitkan, datanya sudah sampai ke browser:

| Data | Sudah diambil di | Ditampilkan? |
|---|---|---|
| `done_at` | `app/api/print/history/route.ts:66` | tidak |
| `failed_at` | `app/api/print/history/route.ts:67` | tidak |
| `printing_at` | belum masuk `select` | tidak |

Tipe `Job` di `debug/page.tsx:26-27` bahkan sudah menampung `done_at`/`failed_at`. Keduanya hanya menganggur.

## Tujuan

Halaman debug bisa menjawab "job ini berapa lama, dan lambatnya di mana" tanpa membuka SQL — termasuk membaca hasil migrasi 0039.

## Non-tujuan

Tidak dikerjakan di sini (sudah dipertimbangkan dan ditunda):

- Ringkasan agregat hari ini per target
- `device_info` di kartu agent (sudah diambil API, belum ditampilkan)
- Filter status/target di UI (parameter `?status=` & `?tx_id=` sudah didukung API, belum dipakai)
- Auto-refresh
- Memasukkan status `printing` ke hitungan ringkasan (`debug/page.tsx:127-129` kini hanya menyaring `pending`/`done`/`failed`)
- IP & port printer per target — perlu agent melaporkannya, artinya rilis APK

## Rancangan

### Jebakan `done_at`: bermakna ganda

Agent menulis waktu klaim ke `done_at` (`PrintHistoryRepository.claim()`), lalu `markDone` menimpanya **hanya kalau job berhasil**. Akibatnya pada baris `failed`, `done_at` adalah waktu **klaim**, bukan waktu selesai.

Rumus durasi karena itu bergantung status:

| Status | Durasi total | Catatan |
|---|---|---|
| `done` | `done_at − created_at` | `done_at` sudah ditimpa `markDone`, jadi asli |
| `failed` | `failed_at − created_at` | `done_at` **diabaikan** — itu stempel klaim |
| `pending`, `printing` | tidak dihitung | belum ada ujungnya |

Tanpa aturan ini, baris gagal akan menampilkan ~0,9 detik (waktu klaim) seolah durasi cetak — salah, dan paling menyesatkan justru ketika sedang dipakai menyelidiki.

### Pecahan dua ruas

Kalau `printing_at` ada, durasi dipecah:

- **kirim** = `printing_at − created_at` — Vercel insert pending → FCM → tablet bangun → UPDATE klaim balik ke Supabase
- **cetak** = `(done_at | failed_at) − printing_at` — socket ke printer + tulis byte + tunggu printer menyerapnya

Istilah "kirim"/"cetak" dipakai di UI, bukan "internet"/"LAN": owner ikut membaca halaman ini (dialah yang menetapkan primary agent di sini) dan tidak perlu tahu arsitekturnya, tapi "cetak 15,2" sudah cukup memberitahunya di mana macetnya.

### Ketelitian angka

`created_at` dan `printing_at` sama-sama dari jam Postgres, jadi ruas **kirim** bersih dari selisih jam. `done_at`/`failed_at` ditulis agent dengan jam tablet, jadi ruas **cetak** dan total ikut membawa selisih itu.

Selisihnya terbukti kecil: ada job yang tuntas total dalam 0,84 detik diukur dengan cara yang sama, jadi skew tidak mungkin lebih besar dari itu. Untuk efek belasan detik yang sedang dikejar, tidak mengganggu. Tapi angka di halaman ini **bukan stopwatch presisi** — jangan dipakai mengukur beda ratusan milidetik.

Konsekuensi praktis: kalau jam tablet mundur, `total` bisa negatif. Nilai negatif di-clamp ke 0 (`Math.max(0, …)`) supaya UI tidak menampilkan angka mustahil. Durasi 0,0 detik yang muncul berulang karena itu adalah **petunjuk jam tablet melenceng**, bukan cetak instan.

### Ambang "lambat"

≥ **5 detik** ditulis merah (`text-brick`).

Dari data 1–8 Agustus: minuman p50 0,84 dtk / p90 1,2 dtk; customer p50 1,76 dtk / p90 5,6 dtk. Ambang 5 detik menyaring yang benar-benar ganjil (4% minuman, 11% customer) tanpa membanjiri layar. Satu ambang untuk semua target — ambang per target menambah aturan yang harus diingat tanpa menambah informasi.

### Baris lama

2.964 baris yang ada sekarang `printing_at`-nya NULL — kolom itu baru ada hari ini. Mereka tetap menampilkan durasi total, hanya tanpa baris pecahan. Tidak ada backfill; datanya memang tidak pernah direkam.

### Bentuk kode

Perhitungan jadi fungsi murni di `lib/print-duration.ts`, mengikuti pola `lib/monitor.ts` dan `lib/cart-draft.ts`. Halaman dan API hanya memasang hasilnya.

```ts
export const SLOW_THRESHOLD_MS = 5000;

export type PrintJobTimestamps = {
  status: 'pending' | 'printing' | 'done' | 'failed';
  created_at: string;
  printing_at: string | null;
  done_at: string | null;
  failed_at: string | null;
};

export type JobDuration = {
  totalMs: number;
  /** created_at → printing_at. null kalau printing_at tidak ada (baris lama). */
  sendMs: number | null;
  /** printing_at → akhir. null kalau printing_at tidak ada. */
  printMs: number | null;
  /** totalMs >= SLOW_THRESHOLD_MS. Dihitung dari total, bukan per ruas. */
  isSlow: boolean;
};

/** null kalau job belum punya ujung (pending/printing) atau stempelnya hilang. */
export function computeJobDuration(job: PrintJobTimestamps): JobDuration | null;

/** 1234 → "1,2 dtk" — koma desimal, satu angka di belakang. */
export function formatDuration(ms: number): string;
```

`computeJobDuration` mengembalikan `null` — bukan nol — kalau stempel yang dibutuhkan tidak ada, supaya UI bisa membedakan "belum selesai" dari "selesai dalam 0 detik".

### Tampilan

Tabel desktop dapat kolom **Durasi** baru (di antara Status dan Reason):

```
16,1 dtk          ← merah kalau ≥ 5 dtk
kirim 0,9 · cetak 15,2   ← kecil, hanya kalau printing_at ada
```

Kartu mobile: baris yang sama, disisipkan di blok Target/Trigger/Agent yang sudah ada.

Job tanpa durasi (`pending`/`printing`) menampilkan `—`.

### Berkas yang berubah

| Berkas | Perubahan |
|---|---|
| `lib/print-duration.ts` | baru — fungsi murni + tipe + konstanta ambang |
| `lib/print-duration.test.ts` | baru |
| `app/api/print/history/route.ts` | `printing_at` di `select` (baris 23), tipe `Row`, dan hasil map |
| `app/(app)/setup/printer/debug/page.tsx` | `printing_at` di tipe `Job`; kolom Durasi di tabel; baris durasi di kartu mobile |

Tanpa migrasi (kolomnya sudah ada), tanpa dependensi baru, tanpa perubahan APK.

## Testing

`lib/print-duration.test.ts`:

- baris `done` dengan `printing_at` → total, `sendMs`, `printMs` benar. Identitas `sendMs + printMs === totalMs` diuji **hanya pada fixture yang semua selisihnya positif**; begitu ada yang ter-clamp (jam tablet mundur) identitas itu memang tidak berlaku, dan itu disengaja — tiap ruas di-clamp sendiri-sendiri supaya tidak ada angka negatif yang lolos ke UI
- baris `done` tanpa `printing_at` (baris lama) → total terisi, `sendMs`/`printMs` null
- baris `failed` → memakai `failed_at`; **`done_at` yang berisi stempel klaim tidak boleh terpakai** (fixture sengaja memasang `done_at` yang jauh lebih awal, sehingga rumus yang salah menghasilkan angka berbeda dan test jatuh)
- baris `pending` dan `printing` → `null`
- `isSlow` tepat di batas: 4999ms false, 5000ms true
- durasi negatif (jam tablet mundur) → di-clamp ke 0, bukan angka negatif
- `formatDuration` → `1234` jadi `"1,2 dtk"`, `59800` jadi `"59,8 dtk"`, `0` jadi `"0,0 dtk"`

## Risiko

| Risiko | Penanganan |
|---|---|
| Rumus `failed` salah dipakai lagi di kemudian hari | aturannya terkunci di fungsi murni + test yang jatuh kalau `done_at` terpakai untuk baris gagal |
| Tabel desktop makin sempit (jadi 8 kolom) | pembungkusnya sudah `overflow-x-auto`; kolom Reason paling lebar dan sudah bisa digeser |
| Owner salah membaca angka sebagai presisi | pecahan ditulis "kirim/cetak" tanpa klaim presisi; catatan skew ada di spec ini, bukan di UI (owner tidak butuh) |
