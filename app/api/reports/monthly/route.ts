import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import {
  parseYm,
  businessMonthRange,
  businessDatesInMonth,
  businessDate,
  currentBusinessDate,
} from '@/lib/date';

const QuerySchema = z.object({ ym: z.string().optional() });

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
    const { data, error } = await supabase
      .from('transactions')
      .select('id, created_at, transaction_items(qty, unit_price_snapshot, menu_name_snapshot)')
      .eq('status', 'confirmed')
      .is('deleted_at', null)
      .gte('created_at', start)
      .lt('created_at', end);

    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const txs = data ?? [];
    const byDay = new Map<string, { total: number; count: number }>();
    const byMenu = new Map<string, { qty: number; revenue: number }>();
    let grandTotal = 0;

    for (const tx of txs) {
      const day = businessDate(new Date(tx.created_at));
      const lines = (tx.transaction_items ?? []) as Array<{
        qty: number; unit_price_snapshot: number; menu_name_snapshot: string;
      }>;
      const txTotal = lines.reduce((acc, l) => acc + l.qty * l.unit_price_snapshot, 0);
      grandTotal += txTotal;
      const day_ = byDay.get(day) ?? { total: 0, count: 0 };
      byDay.set(day, { total: day_.total + txTotal, count: day_.count + 1 });

      for (const l of lines) {
        const prev = byMenu.get(l.menu_name_snapshot) ?? { qty: 0, revenue: 0 };
        byMenu.set(l.menu_name_snapshot, {
          qty: prev.qty + l.qty,
          revenue: prev.revenue + l.qty * l.unit_price_snapshot,
        });
      }
    }

    const allDays = businessDatesInMonth(ym);
    const daily = allDays.map((date) => {
      const v = byDay.get(date) ?? { total: 0, count: 0 };
      return { date, total: v.total, count: v.count };
    });

    const topItems = [...byMenu.entries()]
      .map(([menu_name, v]) => ({ menu_name, qty: v.qty, revenue: v.revenue }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    evt.merge({ tx_count: txs.length, grand_total: grandTotal, days_with_tx: byDay.size });
    tagStatus(evt, 200);
    return NextResponse.json({
      month: ym,
      total: grandTotal,
      count: txs.length,
      daily,
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
