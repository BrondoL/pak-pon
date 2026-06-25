-- 0019_agent_heartbeats_status.sql
-- Explicit online/offline state. Set ke 'online' saat Start button ditekan,
-- 'offline' saat Stop ditekan atau service destroyed.
ALTER TABLE agent_heartbeats
  ADD COLUMN status text NOT NULL DEFAULT 'offline'
              CHECK (status IN ('online','offline'));

CREATE INDEX agent_heartbeats_online_idx
  ON agent_heartbeats (status, last_seen_at DESC)
  WHERE status = 'online';
