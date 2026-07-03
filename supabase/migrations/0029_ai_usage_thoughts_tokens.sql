-- Track Gemini 3.x "thinking" (thoughtsTokenCount) tokens separately.
-- Google bills them as output ($9/1M) but they're hidden from response.text,
-- so previously we under-reported output_tokens by ~570 tok/req avg.
--
-- Semantics from here on:
--   input_tokens    = promptTokenCount
--   output_tokens   = candidatesTokenCount + thoughtsTokenCount  (billable output)
--   thoughts_tokens = thoughtsTokenCount                         (subset of output_tokens, for visibility)
--   total_tokens    = totalTokenCount                            (SDK: prompt + candidates + tools + thoughts)

ALTER TABLE ai_usage_daily
  ADD COLUMN thoughts_tokens bigint NOT NULL DEFAULT 0;

-- Drop old signature and recreate with p_thoughts.
DROP FUNCTION IF EXISTS increment_ai_usage_daily(date, integer, integer, integer, bigint, bigint, bigint);

CREATE OR REPLACE FUNCTION increment_ai_usage_daily(
  p_date     date,
  p_scan     integer,
  p_success  integer,
  p_fail     integer,
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
    date, scan_count, success_count, fail_count,
    input_tokens, output_tokens, thoughts_tokens, total_tokens
  ) VALUES (
    p_date, p_scan, p_success, p_fail, p_input, p_output, p_thoughts, p_total
  )
  ON CONFLICT (date) DO UPDATE SET
    scan_count      = ai_usage_daily.scan_count      + EXCLUDED.scan_count,
    success_count   = ai_usage_daily.success_count   + EXCLUDED.success_count,
    fail_count      = ai_usage_daily.fail_count      + EXCLUDED.fail_count,
    input_tokens    = ai_usage_daily.input_tokens    + EXCLUDED.input_tokens,
    output_tokens   = ai_usage_daily.output_tokens   + EXCLUDED.output_tokens,
    thoughts_tokens = ai_usage_daily.thoughts_tokens + EXCLUDED.thoughts_tokens,
    total_tokens    = ai_usage_daily.total_tokens    + EXCLUDED.total_tokens,
    updated_at      = now();
END;
$$;

REVOKE ALL ON FUNCTION increment_ai_usage_daily(date, integer, integer, integer, bigint, bigint, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_ai_usage_daily(date, integer, integer, integer, bigint, bigint, bigint, bigint) TO authenticated;
