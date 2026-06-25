-- 0020_mark_items_printed_history_trigger.sql
-- Drop Phase 1 trigger (basis: print_queue.status='done' transition).
DROP TRIGGER IF EXISTS trg_print_queue_mark_items ON print_queue;
DROP FUNCTION IF EXISTS mark_items_printed_queue();

-- Versi Phase 2: basis print_history (agent insert dengan status final).
-- Agent insert dengan status='done' atau 'failed' langsung — tidak ada
-- intermediate state. Trigger AFTER INSERT cukup.
CREATE OR REPLACE FUNCTION mark_items_printed_history() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'done'
     AND NEW.item_ids IS NOT NULL
     AND NEW.tx_id IS NOT NULL THEN
    IF NEW.target = 'dapur' THEN
      UPDATE transaction_items
        SET printed_dapur_at = COALESCE(NEW.done_at, now())
        WHERE id = ANY(NEW.item_ids)
          AND transaction_id = NEW.tx_id;
    ELSIF NEW.target = 'minuman' THEN
      UPDATE transaction_items
        SET printed_minuman_at = COALESCE(NEW.done_at, now())
        WHERE id = ANY(NEW.item_ids)
          AND transaction_id = NEW.tx_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_print_history_mark_items
AFTER INSERT ON print_history
FOR EACH ROW EXECUTE FUNCTION mark_items_printed_history();
