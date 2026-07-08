-- Add `is_takeaway` flag ke transactions (dibungkus / makan sini).
-- Owner butuh info ini untuk:
--   1. Kasih tau dapur biar packing beda (di-render besar di kitchen ticket).
--   2. Filter di /transactions ("cari nota bungkus hari ini").
-- Default false = makan sini (mayoritas transaksi).

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS is_takeaway boolean NOT NULL DEFAULT false;

-- Partial index — mayoritas false, jadi index cuma row yang true buat
-- filter "cari bungkus" cepat tanpa bengkak.
CREATE INDEX IF NOT EXISTS idx_transactions_is_takeaway
  ON transactions(created_at DESC)
  WHERE is_takeaway = true AND deleted_at IS NULL;
