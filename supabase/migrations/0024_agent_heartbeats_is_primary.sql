-- 0024_agent_heartbeats_is_primary.sql
-- Primary print agent: 1 agent yang menerima semua dispatch FCM.
-- Lihat docs/superpowers/specs/2026-06-26-primary-agent-selection-design.md
-- untuk konteks (fix race fan-out -> double print + duplicate key).

ALTER TABLE agent_heartbeats
  ADD COLUMN is_primary boolean NOT NULL DEFAULT false;

-- Hanya 1 row boleh true. Partial unique index = database-level guarantee.
CREATE UNIQUE INDEX agent_heartbeats_primary_singleton_idx
  ON agent_heartbeats (is_primary)
  WHERE is_primary = true;

-- Backfill: auto-elect agent dengan heartbeat terbaru (DESC). Tie-break id ASC.
UPDATE agent_heartbeats
  SET is_primary = true
  WHERE id = (
    SELECT id FROM agent_heartbeats
    ORDER BY last_seen_at DESC, id ASC
    LIMIT 1
  );

-- Atomic swap RPC. 2 UPDATE harus jalan dalam transaksi sama supaya
-- partial unique index tidak reject saat ada window 0-primary atau 2-primary.
CREATE OR REPLACE FUNCTION set_primary_agent(target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  UPDATE agent_heartbeats SET is_primary = false WHERE is_primary = true;
  UPDATE agent_heartbeats SET is_primary = true WHERE id = target_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent % not found', target_id USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION set_primary_agent(uuid) TO authenticated;
