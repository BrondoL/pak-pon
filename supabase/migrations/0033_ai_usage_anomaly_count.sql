-- Track "anomaly" scans (Gemini finishReason !== 'STOP') per day.
-- Motivated by 2026-07-11 runaway generation incident: model degenerate loop
-- di `tn` sampai 65k output tokens → bill ~40× normal, JSON invalid, kasir dapet
-- EMPTY_RESULT. Sekarang di-cap `maxOutputTokens: 500` di lib/gemini.ts, tapi
-- kita masih mau tau kapan cap terpicu tanpa harus buka Vercel Log Search.
--
-- anomaly_count = jumlah scan hari itu yang finishReason bukan 'STOP'.
-- Subset dari fail_count (kalau MAX_TOKENS, response JSON pasti invalid → fail).

ALTER TABLE ai_usage_daily
  ADD COLUMN anomaly_count integer NOT NULL DEFAULT 0;

DROP FUNCTION IF EXISTS increment_ai_usage_daily(date, integer, integer, integer, bigint, bigint, bigint, bigint);

CREATE OR REPLACE FUNCTION increment_ai_usage_daily(
  p_date     date,
  p_scan     integer,
  p_success  integer,
  p_fail     integer,
  p_anomaly  integer,
  p_input    bigint,
  p_output   bigint,
  p_thoughts bigint,
  p_total    bigint
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO ai_usage_daily (
    date, scan_count, success_count, fail_count, anomaly_count,
    input_tokens, output_tokens, thoughts_tokens, total_tokens
  ) VALUES (
    p_date, p_scan, p_success, p_fail, p_anomaly, p_input, p_output, p_thoughts, p_total
  )
  ON CONFLICT (date) DO UPDATE SET
    scan_count      = ai_usage_daily.scan_count      + EXCLUDED.scan_count,
    success_count   = ai_usage_daily.success_count   + EXCLUDED.success_count,
    fail_count      = ai_usage_daily.fail_count      + EXCLUDED.fail_count,
    anomaly_count   = ai_usage_daily.anomaly_count   + EXCLUDED.anomaly_count,
    input_tokens    = ai_usage_daily.input_tokens    + EXCLUDED.input_tokens,
    output_tokens   = ai_usage_daily.output_tokens   + EXCLUDED.output_tokens,
    thoughts_tokens = ai_usage_daily.thoughts_tokens + EXCLUDED.thoughts_tokens,
    total_tokens    = ai_usage_daily.total_tokens    + EXCLUDED.total_tokens,
    updated_at      = now();
END;
$$;

REVOKE ALL ON FUNCTION increment_ai_usage_daily(date, integer, integer, integer, integer, bigint, bigint, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_ai_usage_daily(date, integer, integer, integer, integer, bigint, bigint, bigint, bigint) TO authenticated;
