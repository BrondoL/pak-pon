-- Monitor menampilkan pesanan bungkus sejak 2026-08-08, jadi fetchUnpaidRows
-- berhenti mengirim `is_takeaway = false`. Predikat index lama masih memuat
-- klausa itu, sehingga predikat query tidak lagi mengimplikasikannya dan
-- Postgres tidak bisa memakai index ini untuk query monitor.
--
-- Bangun ulang tanpa klausa bungkus supaya cocok lagi. Kolom yang di-index
-- tetap created_at: query monitor selalu memfilter rentang satu hari bisnis
-- lalu mengurutkan naik, jadi range scan di index parsial ini mendarat
-- langsung di irisan hari ini.

DROP INDEX IF EXISTS idx_transactions_unpaid;

CREATE INDEX idx_transactions_unpaid ON transactions (created_at)
  WHERE status = 'confirmed' AND paid_at IS NULL AND deleted_at IS NULL;
