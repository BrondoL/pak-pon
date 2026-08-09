# Instrumentasi Waktu Cetak — Sisi Web & DB — Design Spec

**Tanggal:** 2026-08-09
**Status:** Draft
**Cakupan:** Web + DB saja. Perubahan sisi agent di-spec terpisah di repo `pak-pon-print-agent`: `docs/2026-08-09-timing-instrumentation-and-fixes.md`
**Terkait:** migrasi 0039 (`printing_at`), spec `2026-08-08-print-job-duration-debug-design.md`

## Masalah

Investigasi 8–9 Agustus membuktikan seluruh delay cetak ada di ruas **kirim** (`created_at → printing_at`); ruas cetak selalu 0,13–0,46 detik. Tapi "kirim" masih menggabungkan tiga hal yang berbeda sekali sifatnya:

1. FCM berjalan dari Vercel ke tablet
2. Agent memproses (refresh sesi auth + klaim ke Supabase)
3. — dan kalau FCM tidak pernah sampai, `PendingJobPoller` yang memungut job itu sampai 60 detik kemudian

Selama ketiganya menyatu, kita cuma bisa menebak. Bukti tik-poller semalam didapat dengan membaca pola detik pada stempel waktu — cara yang tidak boleh jadi andalan.

## Tujuan

Halaman debug bisa menjawab dua pertanyaan tanpa menafsirkan pola:

- **Job ini datang lewat FCM atau diselamatkan poller?**
- **Kalau lewat FCM, waktunya habis di perjalanan atau di dalam agent?**

## Non-tujuan

- Ringkasan agregat, filter UI, auto-refresh di halaman debug (masih ditunda, seperti sebelumnya)
- Mengubah perilaku cetak apa pun. Spec ini murni pengukuran; perbaikan perilaku ada di spec agent.

## Model pengukuran — kebal selisih jam

`done_at`/`failed_at` ditulis agent dengan jam tablet, sedangkan `created_at`/`printing_at` dari jam Postgres. Menambah satu stempel `received_at` dari jam tablet akan mengulang persis masalah yang sudah menjebak kita di `done_at`.

Karena itu agent mengirim **durasi**, bukan waktu: `receive_to_claim_ms`, diukur dengan jam monotonik perangkat (`SystemClock.elapsedRealtime()`), sehingga tidak terpengaruh jam dinding sama sekali. Postgres menghitung sisanya:

```
created_at ──────────────────────► printing_at ─────────► selesai
           └── FCM sampai ───┘└── agent ──┘        └ cetak ┘
                (selisih)   (receive_to_claim_ms)
```

- **cetak** = `selesai − printing_at`
- **agent** = `receive_to_claim_ms` (monotonik, dari perangkat)
- **FCM sampai** = `(printing_at − created_at) − receive_to_claim_ms`, di-clamp ke 0

Setiap suku hanya memakai sumber waktu yang konsisten. Tidak ada penjumlahan lintas jam.

## Migrasi 0040

```sql
ALTER TABLE print_history ADD COLUMN claimed_via text
  CHECK (claimed_via IN ('fcm', 'poll'));
ALTER TABLE print_history ADD COLUMN receive_to_claim_ms integer
  CHECK (receive_to_claim_ms >= 0);
```

Dua-duanya **nullable**, dan itu disengaja: baris lama tidak punya nilainya, dan APK lama yang belum di-update tetap harus bisa mengklaim tanpa error. Tidak ada backfill — datanya memang tidak pernah ada.

`claimed_via` sengaja tidak `NOT NULL DEFAULT 'fcm'`: menebak nilai untuk baris lama akan mencemari statistik dengan tebakan yang tidak bisa dibedakan dari pengukuran.

## Perubahan API

`app/api/print/history/route.ts` — tambahkan `claimed_via` dan `receive_to_claim_ms` ke `select`, ke tipe `Row`, dan ke objek hasil map. Pola persis seperti `printing_at` di migrasi sebelumnya.

## `lib/print-duration.ts`

Tipe diperluas; nama lama dipertahankan supaya tidak ada call-site yang perlu ikut berubah:

```ts
export type ClaimedVia = 'fcm' | 'poll';

export type PrintJobTimestamps = {
  status: PrintJobStatus;
  created_at: string;
  printing_at: string | null;
  done_at: string | null;
  failed_at: string | null;
  claimed_via: ClaimedVia | null;
  receive_to_claim_ms: number | null;
};

export type JobDuration = {
  totalMs: number;
  /** created_at → printing_at. Gabungan FCM + agent. */
  sendMs: number | null;
  /** printing_at → akhir. */
  printMs: number | null;
  /** receive_to_claim_ms — lama agent memproses sebelum klaim mendarat. */
  agentMs: number | null;
  /** sendMs − agentMs, clamp ke 0. null kalau salah satu tidak ada. */
  deliverMs: number | null;
  claimedVia: ClaimedVia | null;
  isSlow: boolean;
};
```

`deliverMs` sengaja **null**, bukan 0, kalau `agentMs` tidak ada — supaya baris lama tidak tampil seolah pengirimannya nol detik.

`isSlow` **tidak berubah**: tetap `totalMs >= SLOW_THRESHOLD_MS` (5 detik), dihitung dari total, bukan dari salah satu ruas baru. Aturan `done`/`failed` untuk menentukan waktu akhir juga tidak berubah — baris `failed` tetap memakai `failed_at`, bukan `done_at`.

## Tampilan di halaman debug

Tiga bentuk, dipilih dari data yang tersedia:

| Kondisi | Tampilan |
|---|---|
| `claimed_via='fcm'` + `receive_to_claim_ms` ada | `2,1 dtk` · baris kecil `fcm 1,6 · agent 0,3 · cetak 0,2` |
| `claimed_via='poll'` | `61,2 dtk` + badge **poll** · baris kecil `agent 0,4 · cetak 0,2` |
| baris lama (dua kolom null) | seperti sekarang: `kirim … · cetak …` |

Pada baris `poll`, ruas "fcm" **tidak ditampilkan** — FCM-nya tidak pernah sampai, jadi angka apa pun di situ akan mengarang. Badge `poll` memakai warna peringatan (`text-brick`) karena kehadirannya sendiri adalah gejala: satu job yang lewat poller berarti satu pesan FCM hilang.

## Testing

`lib/print-duration.test.ts` diperluas:

- `claimed_via='fcm'` + `receive_to_claim_ms=300`, `sendMs=2000` → `agentMs=300`, `deliverMs=1700`
- `receive_to_claim_ms` lebih besar dari `sendMs` (mungkin terjadi karena dua sumber waktu berbeda + pembulatan) → `deliverMs` di-clamp ke 0, bukan negatif
- baris lama (dua kolom null) → `agentMs`/`deliverMs` null, `sendMs`/`printMs` tetap seperti sebelumnya
- `claimed_via='poll'` → `claimedVia` diteruskan apa adanya; `deliverMs` tetap dihitung tapi UI yang memutuskan menyembunyikannya

Route handler dan page tidak dites — konvensi repo tidak berubah.

## Risiko

| Risiko | Penanganan |
|---|---|
| APK baru mengirim kolom yang belum ada → PostgREST menolak UPDATE → **tidak ada yang tercetak** | Migrasi diterapkan sebelum APK dibagikan. Praktisnya otomatis: instalasi APK adalah aksi owner yang terjadi belakangan. |
| APK lama + DB baru | Aman: kedua kolom nullable, `claim()` lama tidak menyentuhnya. |
| `deliverMs` negatif karena beda sumber waktu | Di-clamp ke 0, dan diuji. |
| Tabel debug makin padat (10 kolom) | Pecahan tetap di baris kecil dalam sel Durasi yang sudah ada — tidak menambah kolom baru. |
