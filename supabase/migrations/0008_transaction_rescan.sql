-- 0008_transaction_rescan.sql — track per-transaction rescan usage (limit 1x)
-- NULL = never rescanned. Non-null = rescan already used; endpoint refuses further attempts.

ALTER TABLE transactions
  ADD COLUMN rescanned_at timestamptz;

COMMENT ON COLUMN transactions.rescanned_at IS 'Timestamp of the single allowed Pro-only rescan. NULL = available, non-null = already used.';
