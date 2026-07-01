-- 0027_drop_rescanned_at.sql — hapus kolom rescan tracker
-- Konteks: per plan 2026-06-30 sistem OCR jadi single-model no-retry.
-- Route /api/transactions/[id]/rescan dan tombol UI sudah dihapus,
-- kolom ini tidak dipakai lagi.

ALTER TABLE transactions
  DROP COLUMN IF EXISTS rescanned_at;
