-- 0015_print_queue_item_ids.sql
-- List transaction_items.id yang ter-include di job ini.
-- Null untuk: test print (trigger='test') dan customer receipt (tidak update flag).
-- Trigger 0016 pakai kolom ini untuk update transaction_items.printed_*_at.
ALTER TABLE print_queue
  ADD COLUMN item_ids uuid[] NULL;
