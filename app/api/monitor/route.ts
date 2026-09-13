// app/api/monitor/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { guard } from '@/lib/auth/session';
import { newEvent, tagStatus } from '@/lib/logger';
import { fetchUnpaidRows } from '@/lib/monitor-server';

export async function GET(_request: NextRequest) {
  const evt = newEvent('GET /api/monitor');
  try {
    const supabase = await getSupabaseServer();
    const g = await guard(evt, 'monitor.use');
    if (!g.ok) return g.response;

    const rows = await fetchUnpaidRows(supabase);
    const total = rows.reduce((acc, r) => acc + r.total, 0);

    evt.merge({ unpaid_count: rows.length, unpaid_total: total });
    tagStatus(evt, 200);
    return NextResponse.json({ rows, count: rows.length, total });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'error' },
      { status: 500 },
    );
  } finally {
    evt.emit();
  }
}
