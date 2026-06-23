-- 0007_scan_confidence.sql — per-item OCR confidence + top-N alternatives
-- Both nullable: NULL = item added or edited manually by user (no AI confidence applies).

ALTER TABLE transaction_items
  ADD COLUMN confidence  smallint CHECK (confidence BETWEEN 0 AND 100),
  ADD COLUMN alternatives jsonb;

COMMENT ON COLUMN transaction_items.confidence  IS 'Self-reported AI confidence 0-100. NULL kalau item user-added/edited.';
COMMENT ON COLUMN transaction_items.alternatives IS 'JSON array of {menu_name, confidence}, max 2. Kosong/NULL kalau AI sangat yakin atau user-edited.';
