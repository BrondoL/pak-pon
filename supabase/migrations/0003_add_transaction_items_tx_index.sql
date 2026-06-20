-- 0003_add_transaction_items_tx_index.sql
-- Add index on transaction_items.transaction_id — primary join path for the
-- scan-review screen in Plan 2 (fetch items for one transaction).
-- Postgres does NOT auto-index FK columns; only the referenced (parent) side.

CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction_id
  ON transaction_items(transaction_id);
