-- FCM device token, populated by the agent after Firebase registration.
-- Nullable because (a) older agent builds don't set it and (b) Firebase
-- registration is async, so first heartbeat after install is sent without one.
ALTER TABLE public.agent_heartbeats
  ADD COLUMN IF NOT EXISTS fcm_token TEXT;
