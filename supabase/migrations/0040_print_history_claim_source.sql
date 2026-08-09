-- 0040_print_history_claim_source.sql
-- Pecah ruas "kirim" (created_at → printing_at) jadi dua bagian yang beda
-- sifatnya, dan tandai job yang FCM-nya tidak pernah sampai.
--
--   claimed_via         : 'fcm'  = agent menerima push dan langsung memproses
--                         'poll' = FCM TIDAK sampai; PendingJobPoller yang
--                                  memungutnya (sampai 60 detik kemudian)
--   receive_to_claim_ms : lama agent memproses sejak pesan/baris diterima
--                         sampai UPDATE klaim mendarat di Postgres
--
-- receive_to_claim_ms sengaja DURASI, bukan timestamp: agent mengukurnya
-- dengan jam monotonik (SystemClock.elapsedRealtime), jadi kebal dari jam
-- dinding tablet yang bisa melenceng dari jam server. Menambah stempel waktu
-- dari sisi agent akan mengulang jebakan done_at (lihat migrasi 0039).
--
-- Turunannya: FCM sampai = (printing_at - created_at) - receive_to_claim_ms.
--
-- Dua-duanya NULLABLE dan tanpa default. Baris lama memang tidak punya
-- nilainya, dan APK lama yang belum di-update harus tetap bisa mengklaim.
-- Menebak 'fcm' sebagai default akan mencemari statistik dengan tebakan yang
-- tidak bisa dibedakan dari pengukuran.

ALTER TABLE print_history ADD COLUMN claimed_via text
  CHECK (claimed_via IN ('fcm', 'poll'));

ALTER TABLE print_history ADD COLUMN receive_to_claim_ms integer
  CHECK (receive_to_claim_ms >= 0);
