-- 0018_print_history.sql
-- Audit log untuk print jobs. Agent INSERT ke sini setelah job selesai
-- (done/failed). Tidak ada intermediate 'processing' state.
-- bytes_b64 dipreserve supaya owner bisa "Retry" dari agent app.
CREATE TABLE print_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_id           uuid REFERENCES transactions(id) ON DELETE SET NULL,
  agent_id        uuid REFERENCES agent_heartbeats(id) ON DELETE SET NULL,
  agent_label     text,
  target          text NOT NULL CHECK (target IN ('dapur','minuman','customer')),
  trigger         text NOT NULL CHECK (trigger IN
                    ('auto','auto_additional','reprint','reprint_additional','customer','test')),
  item_ids        uuid[] NULL,
  bytes_b64       text NOT NULL,
  status          text NOT NULL CHECK (status IN ('done','failed')),
  failure_reason  text,
  done_at         timestamptz,
  failed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX print_history_recent_idx ON print_history (created_at DESC);
CREATE INDEX print_history_tx_idx ON print_history (tx_id);
CREATE INDEX print_history_failed_idx ON print_history (status, created_at DESC)
  WHERE status = 'failed';

ALTER TABLE print_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read print_history" ON print_history
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert print_history" ON print_history
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update print_history" ON print_history
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth delete print_history" ON print_history
  FOR DELETE TO authenticated USING (true);
