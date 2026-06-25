-- 0023_drop_print_history_agent_id.sql
-- Agent dev decision (lihat docs/superpowers/plans/2026-06-25-print-revamp-phase2-agent.md
-- line ~20 & 408): agent_id selalu NULL, audit pakai agent_label. Kolom tidak
-- pernah di-populate. Drop supaya schema bersih + ngga misleading future devs.
ALTER TABLE print_history DROP COLUMN agent_id;
