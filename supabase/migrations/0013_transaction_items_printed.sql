-- 0013_transaction_items_printed.sql
-- Track kapan tiap item sudah dicetak ke target dapur/minuman.
-- NULL = belum pernah dicetak ke target ini. Dipakai filter "Cetak tambahan"
-- supaya items yang sudah pernah dicetak tidak dikirim ulang ke dapur.
ALTER TABLE transaction_items
  ADD COLUMN printed_dapur_at   timestamptz NULL,
  ADD COLUMN printed_minuman_at timestamptz NULL;
