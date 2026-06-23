-- 0004_print_nota.sql — daily_seq column & print_events table

-- 1. Add daily_seq to transactions
-- Set saat status berubah ke 'confirmed' (di PATCH endpoint).
-- Nullable supaya transaksi 'pending_review' tidak punya seq.
-- Basis hari = business-day WIB (helper di lib/date.ts).
ALTER TABLE transactions ADD COLUMN daily_seq int;

-- Index untuk lookup harian (compute next seq, dan filter business-day)
-- Note: business_date dihitung di app (lib/date.ts), tidak via SQL expression
-- supaya konsisten dengan rest of app.
CREATE INDEX transactions_business_day_seq_idx
  ON transactions (
    ((created_at AT TIME ZONE 'Asia/Jakarta')::date),
    daily_seq
  );

-- 2. print_events table — persist subset wide-event untuk diagnostic page
CREATE TABLE print_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- tx_id nullable: test print events (trigger='test') tidak terkait transaksi
  tx_id       uuid REFERENCES transactions(id) ON DELETE CASCADE,
  daily_seq   int,
  target      text NOT NULL CHECK (target IN ('dapur', 'minuman')),
  trigger     text NOT NULL CHECK (trigger IN ('auto', 'reprint', 'test')),
  outcome     text NOT NULL CHECK (outcome IN ('dispatched', 'reported_success', 'reported_failed')),
  failure_note text,
  url_scheme_variant text,
  user_agent  text,
  user_id     uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX print_events_recent_idx
  ON print_events (created_at DESC);

ALTER TABLE print_events ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read/insert print_events
-- (warung internal, 1 account share, mirror existing transactions policies)
CREATE POLICY "auth read print_events" ON print_events
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth insert print_events" ON print_events
  FOR INSERT TO authenticated WITH CHECK (true);
