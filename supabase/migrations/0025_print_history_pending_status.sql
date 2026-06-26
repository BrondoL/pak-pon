-- 0025_print_history_pending_status.sql
-- Tambah 'pending' state ke print_history. Web INSERT pending sebelum
-- kirim FCM (proof of dispatch + visibility), agent UPDATE saat selesai.
-- Lihat docs/superpowers/specs/2026-06-26-pending-status-print-history-design.md

ALTER TABLE print_history DROP CONSTRAINT IF EXISTS print_history_status_check;
ALTER TABLE print_history ADD CONSTRAINT print_history_status_check
  CHECK (status IN ('pending','done','failed'));

-- Partial index buat poll query agent + cron sweep. Karena mayoritas
-- baris done/failed, partial WHERE status='pending' bikin index kecil.
CREATE INDEX IF NOT EXISTS print_history_pending_idx
  ON print_history (created_at)
  WHERE status = 'pending';
