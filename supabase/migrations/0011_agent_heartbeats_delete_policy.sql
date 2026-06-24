-- 0011_agent_heartbeats_delete_policy.sql — allow authenticated users to delete agent_heartbeats rows
-- (needed for the cleanup button on the debug page).

CREATE POLICY "auth delete agent_heartbeats" ON agent_heartbeats
  FOR DELETE TO authenticated USING (true);
