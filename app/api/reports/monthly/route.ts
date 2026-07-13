import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import {
  parseYm,
  businessMonthRange,
  businessDatesInMonth,
  currentBusinessDate,
  BUSINESS_DAY_CUTOFF_HOURS,
} from '@/lib/date';

const QuerySchema = z.object({ ym: z.string().optional() });

type MonthlyRpc = {
  total: number;
  count: number;
  by_day: { date: string; total: number; count: number }[];
  top_items: { menu_name: string; qty: number; revenue: number }[];
};

function currentYmWIB(): string {
  return currentBusinessDate().slice(0, 7);
}

export async function GET(request: NextRequest) {
  const evt = newEvent('GET /api/reports/monthly');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const parsed = QuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      tagStatus(evt, 400);
      return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
    }
    const ym = (parsed.data.ym && parseYm(parsed.data.ym)) ?? currentYmWIB();
    evt.set('ym', ym);

    const { start, end } = businessMonthRange(ym);
    const { data, error } = await supabase.rpc('report_monthly', {
      p_start: start,
      p_end: end,
      p_cutoff_hours: BUSINESS_DAY_CUTOFF_HOURS,
    });

    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const stats = data as MonthlyRpc;
    const perDay = new Map(stats.by_day.map((d) => [d.date, d]));
    const daily = businessDatesInMonth(ym).map((date) => {
      const v = perDay.get(date);
      return { date, total: v?.total ?? 0, count: v?.count ?? 0 };
    });

    evt.merge({ tx_count: stats.count, grand_total: stats.total, days_with_tx: stats.by_day.length });
    tagStatus(evt, 200);
    return NextResponse.json({
      month: ym,
      total: stats.total,
      count: stats.count,
      daily,
      top_items: stats.top_items,
    });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
