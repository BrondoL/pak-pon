-- 0014_printer_settings_footer.sql
-- Footer text untuk nota customer (e.g. "Terima kasih atas kunjungan Anda").
-- Default empty string supaya nota tanpa konfigurasi tidak print footer.
-- Tidak null karena form selalu submit (string kosong = no footer).
ALTER TABLE printer_settings
  ADD COLUMN footer_text text NOT NULL DEFAULT '';
