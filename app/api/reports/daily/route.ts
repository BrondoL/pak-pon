import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import { currentBusinessDate, parseYmd, businessDayRange } from '@/lib/date';

const QuerySchema = z.object({
  date: z.string().optional(),
});

type DailyRpc = {
  confirmed_total: number;
  confirmed_count: number;
  pending_count: number;
  items: { menu_name: string; qty: number; revenue: number }[];
  mismatches: {
    id: string;
    customer_name: string | null;
    handwritten: number;
    computed: number;
  }[];
};

export async function GET(request: NextRequest) {
  const evt = newEvent('GET /api/reports/daily');
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
    const date = (parsed.data.date && parseYmd(parsed.data.date)) ?? currentBusinessDate();
    evt.set('date', date);

    const { start, end } = businessDayRange(date);
    const { data, error } = await supabase.rpc('report_daily', {
      p_start: start,
      p_end: end,
    });

    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const stats = data as DailyRpc;
    const topItems = stats.items.slice(0, 5);

    evt.merge({ tx_count: stats.confirmed_count, total: stats.confirmed_total, top_items_count: topItems.length });
    tagStatus(evt, 200);
    return NextResponse.json({
      date,
      total: stats.confirmed_total,
      count: stats.confirmed_count,
      top_items: topItems,
    });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
