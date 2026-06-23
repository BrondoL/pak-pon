-- 0005_print_queue.sql — replace print_events with print_queue + agent_heartbeats

-- 1. Drop print_events (replaced by print_queue + wide-event logger)
DROP TABLE IF EXISTS print_events;

-- 2. print_queue — job queue, agent consume from here
CREATE TABLE print_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- tx_id nullable: test print jobs (trigger='test') tidak terkait transaksi
  tx_id           uuid REFERENCES transactions(id) ON DELETE CASCADE,
  target          text NOT NULL CHECK (target IN ('dapur', 'minuman')),
  trigger         text NOT NULL CHECK (trigger IN ('auto', 'reprint', 'test')),
  bytes_b64       text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'printing', 'done', 'failed')),
  failure_reason  text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  picked_up_at    timestamptz,
  completed_at    timestamptz
);

CREATE INDEX print_queue_status_created_idx
  ON print_queue (status, created_at)
  WHERE status IN ('pending', 'printing');

CREATE INDEX print_queue_recent_idx
  ON print_queue (created_at DESC);

ALTER TABLE print_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read print_queue" ON print_queue
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth insert print_queue" ON print_queue
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "auth update print_queue" ON print_queue
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 3. agent_heartbeats — track agent online status
CREATE TABLE agent_heartbeats (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_label     text NOT NULL UNIQUE,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  agent_version   text,
  device_info     text
);

CREATE INDEX agent_heartbeats_recent_idx
  ON agent_heartbeats (last_seen_at DESC);

ALTER TABLE agent_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read agent_heartbeats" ON agent_heartbeats
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth insert agent_heartbeats" ON agent_heartbeats
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "auth update agent_heartbeats" ON agent_heartbeats
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 4. Enable realtime on print_queue (untuk push notif ke Print Agent)
ALTER PUBLICATION supabase_realtime ADD TABLE print_queue;
