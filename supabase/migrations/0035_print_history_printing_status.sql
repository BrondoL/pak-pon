-- 0035_print_history_printing_status.sql
-- Fix nota kecetak duplikat (2-3x nota sama). Root cause: agent print DULU
-- baru mark done. Kalau physical print sukses tapi DB write gagal (JWT expired
-- karena OEM freeze, jaringan putus sesaat), row tetap 'pending' → poller
-- fallback fetch lagi tiap 60s → cetak ulang sampai cron sweep mark failed
-- di menit ke-5 (bisa 2-5 duplikat).
--
-- Solusi: intermediate state 'printing'. Agent CLAIM atomik SEBELUM TCP send
-- (UPDATE status='printing' WHERE id=? AND status='pending'), cek affected==1.
-- Kalau 0 → worker lain sudah klaim / sudah tercetak → JANGAN print. Ini ubah
-- race dari "dua-duanya print" jadi "satu klaim, satu print". Poller filter
-- status='pending' → row 'printing' tidak ke-fetch ulang.

-- 1. Tambah 'printing' ke status constraint.
ALTER TABLE print_history DROP CONSTRAINT IF EXISTS print_history_status_check;
ALTER TABLE print_history ADD CONSTRAINT print_history_status_check
  CHECK (status IN ('pending', 'printing', 'done', 'failed'));

-- 2. Update trigger mark_items_printed_history.
-- Agent baru: pending -> printing -> done (transisi ke done dari 'printing').
-- Agent lama: pending -> done langsung. Terima OLD IN ('pending','printing')
-- supaya printed_*_at tetap ke-set di dua-duanya — bikin migrasi ini aman
-- di-deploy tanpa harus barengan sama update agent (tidak ada window di mana
-- printed_*_at diam-diam tidak ke-set).
CREATE OR REPLACE FUNCTION mark_items_printed_history() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'done'
     AND OLD.status IN ('pending', 'printing')
     AND NEW.item_ids IS NOT NULL
     AND NEW.tx_id IS NOT NULL THEN
    IF NEW.target = 'dapur' THEN
      UPDATE transaction_items
        SET printed_dapur_at = COALESCE(NEW.done_at, now())
        WHERE id = ANY(NEW.item_ids)
          AND transaction_id = NEW.tx_id;
    ELSIF NEW.target = 'minuman' THEN
      UPDATE transaction_items
        SET printed_minuman_at = COALESCE(NEW.done_at, now())
        WHERE id = ANY(NEW.item_ids)
          AND transaction_id = NEW.tx_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
