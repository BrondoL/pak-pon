-- 0036_transactions_paid_at.sql
-- Status bayar untuk fitur Monitor meja belum bayar.
-- NULL = belum bayar; timestamp = sudah bayar.
-- Operasional saja — laporan (report_*) TIDAK memakai kolom ini. Data lama paid_at=NULL
-- tidak masalah karena filter monitor dibatasi hari bisnis berjalan.

ALTER TABLE transactions ADD COLUMN paid_at timestamptz;

-- Index parsial: query monitor hanya menyentuh baris confirmed + dine-in + belum bayar + belum dihapus.
CREATE INDEX IF NOT EXISTS idx_transactions_unpaid
  ON transactions (created_at)
  WHERE status = 'confirmed' AND is_takeaway = false AND paid_at IS NULL AND deleted_at IS NULL;
