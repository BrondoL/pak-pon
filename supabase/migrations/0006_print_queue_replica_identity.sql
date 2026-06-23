-- 0006_print_queue_replica_identity.sql
-- Enable REPLICA IDENTITY FULL on print_queue so realtime UPDATE/DELETE events
-- carry the full row payload (not just PK). Required for Spec B agent or any
-- consumer that subscribes to status transitions.
ALTER TABLE print_queue REPLICA IDENTITY FULL;
