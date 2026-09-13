-- 0046_transactions_created_by.sql
-- Siapa yang menginput transaksi. Berguna saat selisih kas atau nota aneh —
-- sebelum ini, dengan satu akun bersama, tidak ada jejak sama sekali.
--
-- SET NULL, bukan CASCADE: menghapus akun kasir tidak boleh menghapus transaksinya.
-- Nullable tanpa backfill — transaksi sebelum fitur ini memang tidak diketahui pembuatnya.

ALTER TABLE transactions
  ADD COLUMN created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX idx_transactions_created_by ON transactions(created_by)
  WHERE created_by IS NOT NULL;
