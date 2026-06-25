-- 0017_print_queue_constraints.sql
-- Target: tambah 'customer' untuk nota dengan harga.
-- Trigger: tambah 'auto_additional', 'reprint_additional', 'customer'.
ALTER TABLE print_queue DROP CONSTRAINT IF EXISTS print_queue_target_check;
ALTER TABLE print_queue ADD CONSTRAINT print_queue_target_check
  CHECK (target IN ('dapur', 'minuman', 'customer'));

ALTER TABLE print_queue DROP CONSTRAINT IF EXISTS print_queue_trigger_check;
ALTER TABLE print_queue ADD CONSTRAINT print_queue_trigger_check
  CHECK (trigger IN ('auto', 'auto_additional', 'reprint', 'reprint_additional', 'customer', 'test'));
