-- 0034_report_rpcs.sql
-- SQL-side aggregates untuk laporan. Pre-fix: JS iterasi ratusan-ribuan row hasil
-- select tanpa order/limit. PostgREST default `db-max-rows = 1000` (Supabase Cloud)
-- diam-diam truncate → total under-report, hari random hilang dari grafik.
-- Insiden 2026-07-13: bulan Juli 1779 tx confirmed → 779 row hilang, business date
-- 2026-07-11 kebetulan drop full (247 tx, Rp 33 jt) karena physical row order.
--
-- Semua fungsi: LANGUAGE sql (planner-friendly, no plpgsql overhead), STABLE,
-- SECURITY INVOKER (RLS tabel dasar tetap enforce), search_path lock.

-- ------------------------------------------------------------
-- Home dashboard: ringkasan hari ini
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION report_home_today(
  p_start timestamptz,
  p_end   timestamptz
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH scope AS (
    SELECT t.id, t.status
    FROM transactions t
    WHERE t.deleted_at IS NULL
      AND t.created_at >= p_start
      AND t.created_at <  p_end
  ),
  counts AS (
    SELECT
      count(*) FILTER (WHERE status = 'confirmed')::int      AS confirmed_count,
      count(*) FILTER (WHERE status = 'pending_review')::int AS pending_count
    FROM scope
  ),
  revenue AS (
    SELECT coalesce(sum(ti.qty * ti.unit_price_snapshot), 0)::bigint AS confirmed_total
    FROM scope s
    JOIN transaction_items ti ON ti.transaction_id = s.id
    WHERE s.status = 'confirmed'
  )
  SELECT jsonb_build_object(
    'confirmed_total', (SELECT confirmed_total FROM revenue),
    'confirmed_count', (SELECT confirmed_count FROM counts),
    'pending_count',   (SELECT pending_count   FROM counts)
  );
$$;

REVOKE ALL ON FUNCTION report_home_today(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION report_home_today(timestamptz, timestamptz) TO authenticated;

-- ------------------------------------------------------------
-- Daily report: total, count, all menu items (sorted qty desc), mismatch list
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION report_daily(
  p_start timestamptz,
  p_end   timestamptz
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH scope AS (
    SELECT t.id, t.status, t.customer_name, t.handwritten_total
    FROM transactions t
    WHERE t.deleted_at IS NULL
      AND t.created_at >= p_start
      AND t.created_at <  p_end
  ),
  counts AS (
    SELECT
      count(*) FILTER (WHERE status = 'confirmed')::int      AS confirmed_count,
      count(*) FILTER (WHERE status = 'pending_review')::int AS pending_count
    FROM scope
  ),
  tx_totals AS (
    SELECT s.id, s.customer_name, s.handwritten_total,
      coalesce(sum(ti.qty * ti.unit_price_snapshot), 0)::bigint AS computed_total
    FROM scope s
    LEFT JOIN transaction_items ti ON ti.transaction_id = s.id
    WHERE s.status = 'confirmed'
    GROUP BY s.id, s.customer_name, s.handwritten_total
  ),
  revenue AS (
    SELECT coalesce(sum(computed_total), 0)::bigint AS confirmed_total FROM tx_totals
  ),
  items AS (
    SELECT ti.menu_name_snapshot AS menu_name,
      sum(ti.qty)::int                              AS qty,
      sum(ti.qty * ti.unit_price_snapshot)::bigint  AS revenue
    FROM scope s
    JOIN transaction_items ti ON ti.transaction_id = s.id
    WHERE s.status = 'confirmed'
    GROUP BY ti.menu_name_snapshot
  ),
  mismatches AS (
    SELECT id, customer_name,
      handwritten_total AS handwritten,
      computed_total    AS computed
    FROM tx_totals
    WHERE handwritten_total IS NOT NULL
      AND handwritten_total <> computed_total
  )
  SELECT jsonb_build_object(
    'confirmed_total', (SELECT confirmed_total FROM revenue),
    'confirmed_count', (SELECT confirmed_count FROM counts),
    'pending_count',   (SELECT pending_count   FROM counts),
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'menu_name', menu_name,
        'qty',       qty,
        'revenue',   revenue
      ) ORDER BY qty DESC, menu_name ASC) FROM items
    ), '[]'::jsonb),
    'mismatches', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id',            id,
        'customer_name', customer_name,
        'handwritten',   handwritten,
        'computed',      computed
      )) FROM mismatches
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION report_daily(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION report_daily(timestamptz, timestamptz) TO authenticated;

-- ------------------------------------------------------------
-- Monthly report: total, count, per business_date bucket, top 5 menu
-- Cutoff hours dilempar dari JS (env NEXT_PUBLIC_BUSINESS_DAY_CUTOFF_HOURS)
-- supaya sumber kebenaran business-day logic tetap satu di lib/date.ts.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION report_monthly(
  p_start         timestamptz,
  p_end           timestamptz,
  p_cutoff_hours  int
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH scope AS (
    SELECT
      t.id,
      ((t.created_at AT TIME ZONE 'Asia/Jakarta') - make_interval(hours => p_cutoff_hours))::date
        AS business_date
    FROM transactions t
    WHERE t.status = 'confirmed'
      AND t.deleted_at IS NULL
      AND t.created_at >= p_start
      AND t.created_at <  p_end
  ),
  tx_totals AS (
    SELECT s.id, s.business_date,
      coalesce(sum(ti.qty * ti.unit_price_snapshot), 0)::bigint AS tx_total
    FROM scope s
    LEFT JOIN transaction_items ti ON ti.transaction_id = s.id
    GROUP BY s.id, s.business_date
  ),
  by_day AS (
    SELECT business_date,
      count(*)::int         AS n,
      sum(tx_total)::bigint AS total
    FROM tx_totals
    GROUP BY business_date
  ),
  overall AS (
    SELECT
      count(*)::int                       AS n,
      coalesce(sum(tx_total), 0)::bigint  AS total
    FROM tx_totals
  ),
  by_menu AS (
    SELECT ti.menu_name_snapshot AS menu_name,
      sum(ti.qty)::int                              AS qty,
      sum(ti.qty * ti.unit_price_snapshot)::bigint  AS revenue
    FROM scope s
    JOIN transaction_items ti ON ti.transaction_id = s.id
    GROUP BY ti.menu_name_snapshot
    ORDER BY sum(ti.qty) DESC, ti.menu_name_snapshot ASC
    LIMIT 5
  )
  SELECT jsonb_build_object(
    'total', (SELECT total FROM overall),
    'count', (SELECT n     FROM overall),
    'by_day', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'date',  to_char(business_date, 'YYYY-MM-DD'),
        'total', total,
        'count', n
      ) ORDER BY business_date) FROM by_day
    ), '[]'::jsonb),
    'top_items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'menu_name', menu_name,
        'qty',       qty,
        'revenue',   revenue
      ) ORDER BY qty DESC, menu_name ASC) FROM by_menu
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION report_monthly(timestamptz, timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION report_monthly(timestamptz, timestamptz, int) TO authenticated;

-- ------------------------------------------------------------
-- Transactions list summary card: matched-total + counts under active filters
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION report_transactions_summary(
  p_start     timestamptz,
  p_end       timestamptz,
  p_q         text,
  p_status    text,
  p_takeaway  boolean
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH scope AS (
    SELECT t.id, t.status
    FROM transactions t
    WHERE t.deleted_at IS NULL
      AND t.created_at >= p_start
      AND t.created_at <  p_end
      AND (p_q IS NULL OR p_q = '' OR t.customer_name ILIKE '%' || p_q || '%')
      AND (p_status IS NULL OR t.status = p_status)
      AND (p_takeaway IS NULL OR t.is_takeaway = p_takeaway)
  ),
  counts AS (
    SELECT
      count(*)::int                                          AS total_count,
      count(*) FILTER (WHERE status = 'confirmed')::int      AS confirmed_count,
      count(*) FILTER (WHERE status = 'pending_review')::int AS pending_count
    FROM scope
  ),
  revenue AS (
    SELECT coalesce(sum(ti.qty * ti.unit_price_snapshot), 0)::bigint AS confirmed_total
    FROM scope s
    JOIN transaction_items ti ON ti.transaction_id = s.id
    WHERE s.status = 'confirmed'
  )
  SELECT jsonb_build_object(
    'total_count',     (SELECT total_count     FROM counts),
    'confirmed_total', (SELECT confirmed_total FROM revenue),
    'confirmed_count', (SELECT confirmed_count FROM counts),
    'pending_count',   (SELECT pending_count   FROM counts)
  );
$$;

REVOKE ALL ON FUNCTION report_transactions_summary(timestamptz, timestamptz, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION report_transactions_summary(timestamptz, timestamptz, text, text, boolean) TO authenticated;
