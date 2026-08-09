-- 0041_claimed_via_manual.sql
-- Tambah nilai ketiga 'manual' ke claimed_via.
--
-- Migrasi 0040 mendefinisikan claimed_via HANYA 'fcm' / 'poll' dengan makna
-- spesifik: 'poll' berarti FCM TIDAK sampai dan PendingJobPoller (60 detik)
-- yang memungut job-nya — ini metrik yang dipakai investigasi kehilangan FCM.
--
-- Ternyata ada jalur ketiga: agent app punya tombol "retry" manual di tab
-- History. Kalau retry itu ditandai 'poll', metrik kehilangan FCM tercemar
-- oleh job yang sengaja di-retry owner/kasir, bukan job yang FCM-nya benar-
-- benar hilang. 'poll' harus tetap berarti PERSIS "FCM hilang" — jadi retry
-- manual dapat nilai sendiri: 'manual'.
--
-- Constraint dari 0040 dibuat inline lewat ADD COLUMN ... CHECK (...), tapi
-- Postgres kebetulan memberi nama sesuai konvensi default
-- (print_history_claimed_via_check) — dicek dulu lewat pg_constraint sebelum
-- migrasi ini ditulis. Tetap di-drop by name (bukan asumsi) + re-add dengan
-- nama eksplisit biar migrasi berikutnya tidak perlu menebak lagi.
--
-- Idempoten: DROP CONSTRAINT IF EXISTS + nama constraint baru fixed, jadi
-- aman dijalankan ulang (re-run kedua akan no-op di DROP, lalu gagal di ADD
-- kalau constraint sudah ada dengan definisi sama — tapi berhenti sebelum
-- pernah membuat konstrain longgar tak sengaja tertinggal).

ALTER TABLE print_history
  DROP CONSTRAINT IF EXISTS print_history_claimed_via_check;

ALTER TABLE print_history
  ADD CONSTRAINT print_history_claimed_via_check
  CHECK (claimed_via IN ('fcm', 'poll', 'manual'));
