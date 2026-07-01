-- Track daily OCR (Gemini) token usage. 1 row per hari WIB (via businessDate).
-- Populated best-effort dari /api/scan finally block via RPC increment_ai_usage_daily.

CREATE TABLE ai_usage_daily (
  date            date PRIMARY KEY,
  scan_count      integer NOT NULL DEFAULT 0,
  success_count   integer NOT NULL DEFAULT 0,
  fail_count      integer NOT NULL DEFAULT 0,
  input_tokens    bigint  NOT NULL DEFAULT 0,
  output_tokens   bigint  NOT NULL DEFAULT 0,
  total_tokens    bigint  NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_usage_daily_date_desc ON ai_usage_daily (date DESC);

CREATE TRIGGER ai_usage_daily_touch
  BEFORE UPDATE ON ai_usage_daily
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION increment_ai_usage_daily(
  p_date    date,
  p_scan    integer,
  p_success integer,
  p_fail    integer,
  p_input   bigint,
  p_output  bigint,
  p_total   bigint
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO ai_usage_daily (
    date, scan_count, success_count, fail_count,
    input_tokens, output_tokens, total_tokens
  ) VALUES (
    p_date, p_scan, p_success, p_fail, p_input, p_output, p_total
  )
  ON CONFLICT (date) DO UPDATE SET
    scan_count    = ai_usage_daily.scan_count    + EXCLUDED.scan_count,
    success_count = ai_usage_daily.success_count + EXCLUDED.success_count,
    fail_count    = ai_usage_daily.fail_count    + EXCLUDED.fail_count,
    input_tokens  = ai_usage_daily.input_tokens  + EXCLUDED.input_tokens,
    output_tokens = ai_usage_daily.output_tokens + EXCLUDED.output_tokens,
    total_tokens  = ai_usage_daily.total_tokens  + EXCLUDED.total_tokens,
    updated_at    = now();
END;
$$;

REVOKE ALL ON FUNCTION increment_ai_usage_daily(date, integer, integer, integer, bigint, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_ai_usage_daily(date, integer, integer, integer, bigint, bigint, bigint) TO authenticated;

ALTER TABLE ai_usage_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_usage_daily_read ON ai_usage_daily
  FOR SELECT USING (auth.role() = 'authenticated');
