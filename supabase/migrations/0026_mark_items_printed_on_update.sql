-- 0026_mark_items_printed_on_update.sql
-- Trigger sebelumnya AFTER INSERT (agent INSERT row done langsung).
-- Sekarang flow: web INSERT pending -> agent UPDATE done. Trigger pindah
-- ke AFTER UPDATE OF status, fire saat OLD='pending' AND NEW='done'.

DROP TRIGGER IF EXISTS trg_print_history_mark_items ON print_history;

CREATE OR REPLACE FUNCTION mark_items_printed_history() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'done'
     AND OLD.status = 'pending'
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
AFTER UPDATE OF status ON print_history
FOR EACH ROW EXECUTE FUNCTION mark_items_printed_history();
