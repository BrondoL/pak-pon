import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const VALID_STATUS = ['pending', 'printing', 'done', 'failed'] as const;

export async function GET(request: NextRequest) {
  const evt = newEvent('GET /api/print/queue/recent');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const limitParam = request.nextUrl.searchParams.get('limit');
    const statusParam = request.nextUrl.searchParams.get('status');

    const limit = Math.min(
      Math.max(parseInt(limitParam ?? `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );
    evt.set('limit', limit);

    let query = supabase
      .from('print_queue')
      .select('id, tx_id, target, trigger, status, failure_reason, created_at, picked_up_at, completed_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (statusParam && statusParam !== 'all' && (VALID_STATUS as readonly string[]).includes(statusParam)) {
      query = query.eq('status', statusParam);
      evt.set('filter_status', statusParam);
    }

    const { data, error } = await query;
    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    evt.set('rows_count', data?.length ?? 0);
    tagStatus(evt, 200);
    return NextResponse.json({ jobs: data ?? [] });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
