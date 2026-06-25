-- 0016_mark_items_printed_trigger.sql
-- Saat print_queue.status transition ke 'done' dengan item_ids non-null,
-- update transaction_items.printed_X_at sesuai target.
-- Akan di-DROP di Phase 2 dan diganti trigger pada print_history.
CREATE OR REPLACE FUNCTION mark_items_printed_queue() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'done'
     AND OLD.status IS DISTINCT FROM 'done'
     AND NEW.item_ids IS NOT NULL
     AND NEW.tx_id IS NOT NULL THEN
    IF NEW.target = 'dapur' THEN
      UPDATE transaction_items
        SET printed_dapur_at = COALESCE(NEW.completed_at, now())
        WHERE id = ANY(NEW.item_ids)
          AND transaction_id = NEW.tx_id;
    ELSIF NEW.target = 'minuman' THEN
      UPDATE transaction_items
        SET printed_minuman_at = COALESCE(NEW.completed_at, now())
        WHERE id = ANY(NEW.item_ids)
          AND transaction_id = NEW.tx_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_print_queue_mark_items
AFTER UPDATE OF status ON print_queue
FOR EACH ROW EXECUTE FUNCTION mark_items_printed_queue();
