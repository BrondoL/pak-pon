import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import { today, parseYmd, startOfDayWIB, endOfDayWIB } from '@/lib/date';

const PAGE_SIZE = 50;

const QuerySchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  q: z.string().optional(),
  status: z.enum(['pending_review', 'confirmed']).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export async function GET(request: NextRequest) {
  const evt = newEvent('GET /api/transactions');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const sp = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = QuerySchema.safeParse(sp);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ reject_reason: 'invalid_query', zod_issues: parsed.error.issues });
      return NextResponse.json({ error: 'invalid_query', details: parsed.error.flatten() }, { status: 400 });
    }

    const defaultDay = today();
    const dateFrom = (parsed.data.date_from && parseYmd(parsed.data.date_from)) ?? defaultDay;
    const dateTo = (parsed.data.date_to && parseYmd(parsed.data.date_to)) ?? dateFrom;
    const page = parsed.data.page;
    evt.merge({ date_from: dateFrom, date_to: dateTo, page, q: parsed.data.q, status_filter: parsed.data.status });

    let query = supabase
      .from('transactions')
      .select(
        'id, created_at, status, customer_name, table_no, handwritten_total, transaction_items(qty, unit_price_snapshot)',
        { count: 'exact' }
      )
      .is('deleted_at', null)
      .gte('created_at', startOfDayWIB(dateFrom))
      .lt('created_at', endOfDayWIB(dateTo))
      .order('created_at', { ascending: false });

    if (parsed.data.q && parsed.data.q.trim() !== '') {
      query = query.ilike('customer_name', `%${parsed.data.q.trim()}%`);
    }
    if (parsed.data.status) {
      query = query.eq('status', parsed.data.status);
    }

    const offset = (page - 1) * PAGE_SIZE;
    query = query.range(offset, offset + PAGE_SIZE - 1);

    const { data, error, count } = await query;
    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const items = (data ?? []).map((tx) => {
      const lines = (tx.transaction_items ?? []) as Array<{ qty: number; unit_price_snapshot: number }>;
      const total = lines.reduce((acc, l) => acc + l.qty * l.unit_price_snapshot, 0);
      return {
        id: tx.id,
        created_at: tx.created_at,
        status: tx.status,
        customer_name: tx.customer_name,
        table_no: tx.table_no,
        handwritten_total: tx.handwritten_total,
        total,
        item_count: lines.length,
      };
    });

    evt.merge({ items_count: items.length, total_count: count ?? 0 });
    tagStatus(evt, 200);
    return NextResponse.json({
      items,
      page,
      page_size: PAGE_SIZE,
      total_count: count ?? 0,
    });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
