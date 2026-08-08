-- 0039_print_history_printing_at.sql
-- Stempel waktu klaim job (transisi pending -> printing) supaya delay cetak
-- bisa dipecah jadi dua ruas yang beda domain jaringan:
--
--   created_at  -> printing_at : ruas INTERNET. Vercel insert pending -> FCM ->
--                                tablet bangun & proses -> UPDATE klaim balik
--                                ke Supabase. Besar di sini = FCM lambat, tablet
--                                ke-doze, atau uplink internet warung jelek.
--   printing_at -> done_at     : ruas LAN. Socket ke printer + tulis byte +
--                                tunggu printer menyerapnya. Besar di sini =
--                                printernya yang lambat/tidur.
--
-- Latar: nota customer kadang 3-16 detik sementara tiket minuman konsisten
-- ~0,8 detik (data 1-8 Agustus 2026). Jalur dispatch di web identik untuk
-- ketiga target, jadi selisihnya pasti sesudah job masuk antrian — tapi tanpa
-- kolom ini tidak bisa dipastikan ruas yang mana.
--
-- TANPA UPDATE APK. Agent 1.1.0 sudah mengirim UPDATE klaim atomik
-- (PrintHistoryRepository.claim() -> set status='printing' where status='pending'),
-- trigger ini cuma menumpang UPDATE yang sudah ada.
--
-- Sengaja pakai now() (jam Postgres), bukan jam tablet. Agent menulis waktu
-- klaim ke done_at pakai Instant.now() perangkat; itu tetap dibiarkan supaya
-- perilaku agent tidak berubah, tapi untuk pengukuran pakai printing_at —
-- created_at dan printing_at sama-sama dari jam server, jadi selisihnya bersih
-- dari clock skew tablet.
--
-- Catatan baca data: done_at bermakna ganda pada baris lama — waktu klaim di
-- baris status='failed' (ditimpa markDone kalau sukses), waktu selesai di baris
-- status='done'. Setelah migrasi ini pakai printing_at untuk waktu klaim.

ALTER TABLE print_history ADD COLUMN printing_at timestamptz;

CREATE OR REPLACE FUNCTION stamp_print_history_printing_at() RETURNS trigger AS $$
BEGIN
  -- Hanya transisi klaim yang distempel. Agent lama (pending -> done langsung)
  -- tidak kena trigger ini dan tetap jalan normal dengan printing_at NULL.
  IF NEW.status = 'printing' AND OLD.status = 'pending' THEN
    NEW.printing_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- BEFORE, supaya nilainya ikut tertulis di UPDATE yang sama (tanpa write kedua).
-- Terpisah dari trigger AFTER mark_items_printed_history yang urusannya lain.
DROP TRIGGER IF EXISTS print_history_stamp_printing_at ON print_history;
CREATE TRIGGER print_history_stamp_printing_at
  BEFORE UPDATE OF status ON print_history
  FOR EACH ROW EXECUTE FUNCTION stamp_print_history_printing_at();
