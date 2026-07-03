-- Drop `alternatives` column dari transaction_items.
-- Feature "alternatif chip" (swap cepat via AI suggestion) di-remove per 2026-07-03:
-- Gemini `a` field stochastic + UX churn ga sepadan dengan cost tokens.
-- Item ambigu tetap di-highlight lewat `confidence` (tier merah/kuning),
-- kasir edit manual via modal.

ALTER TABLE transaction_items DROP COLUMN IF EXISTS alternatives;
