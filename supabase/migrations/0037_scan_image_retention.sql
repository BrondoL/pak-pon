-- 0037_scan_image_retention.sql
-- Retensi foto nota 7 hari: cron cleanup menghapus foto (scan_image_path → bucket
-- notas) untuk transaksi >7 hari TANPA menghapus transaksinya. Kolom ini menandai
-- foto yang sudah dibuang, sekaligus membedakan transaksi POS (scan_image_path NULL
-- sejak awal) vs OCR yang fotonya sudah di-purge (purged_at terisi) di badge riwayat.
-- NULL = foto belum pernah di-purge oleh cron.

ALTER TABLE transactions ADD COLUMN scan_image_purged_at timestamptz;

-- Index parsial: pass purge di cron hanya menyentuh baris yang masih punya foto.
-- Begitu scan_image_path di-NULL-kan, baris keluar dari index (idempoten + murah).
CREATE INDEX IF NOT EXISTS idx_transactions_photo_purgeable
  ON transactions (created_at)
  WHERE scan_image_path IS NOT NULL;
