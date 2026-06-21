import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import { today, parseYmd, startOfDayWIB, endOfDayWIB } from '@/lib/date';

const QuerySchema = z.object({
  date: z.string().optional(),
});

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
    const date = (parsed.data.date && parseYmd(parsed.data.date)) ?? today();
    evt.set('date', date);

    const { data, error } = await supabase
      .from('transactions')
      .select('id, transaction_items(qty, unit_price_snapshot, menu_name_snapshot)')
      .eq('status', 'confirmed')
      .is('deleted_at', null)
      .gte('created_at', startOfDayWIB(date))
      .lt('created_at', endOfDayWIB(date));

    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const txs = data ?? [];
    let total = 0;
    const byMenu = new Map<string, { qty: number; revenue: number }>();

    for (const tx of txs) {
      const lines = (tx.transaction_items ?? []) as Array<{
        qty: number; unit_price_snapshot: number; menu_name_snapshot: string;
      }>;
      for (const l of lines) {
        const lineTotal = l.qty * l.unit_price_snapshot;
        total += lineTotal;
        const prev = byMenu.get(l.menu_name_snapshot) ?? { qty: 0, revenue: 0 };
        byMenu.set(l.menu_name_snapshot, {
          qty: prev.qty + l.qty,
          revenue: prev.revenue + lineTotal,
        });
      }
    }

    const topItems = [...byMenu.entries()]
      .map(([menu_name, v]) => ({ menu_name, qty: v.qty, revenue: v.revenue }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    evt.merge({ tx_count: txs.length, total, top_items_count: topItems.length });
    tagStatus(evt, 200);
    return NextResponse.json({
      date,
      total,
      count: txs.length,
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
