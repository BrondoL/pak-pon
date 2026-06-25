-- 0011a_agent_heartbeats_agent_uuid.sql
-- Retrofit: kolom ini sudah ada di Supabase (dipakai agent app via
-- onConflict='agent_uuid' upsert) tapi belum di-commit ke repo.
-- Tipe = uuid NOT NULL (agent generate UUID per device install).
-- IF NOT EXISTS supaya re-apply tidak error.
ALTER TABLE agent_heartbeats
  ADD COLUMN IF NOT EXISTS agent_uuid uuid;

-- Tighten ke NOT NULL kalau memang sudah di-populate untuk semua row.
-- Tidak fatal kalau ada row legacy yang masih NULL — skip.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM agent_heartbeats WHERE agent_uuid IS NULL) THEN
    ALTER TABLE agent_heartbeats ALTER COLUMN agent_uuid SET NOT NULL;
  END IF;
EXCEPTION WHEN others THEN
  -- constraint sudah ada — abaikan
  NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS agent_heartbeats_agent_uuid_idx
  ON agent_heartbeats (agent_uuid)
  WHERE agent_uuid IS NOT NULL;
