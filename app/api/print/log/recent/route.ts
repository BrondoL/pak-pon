import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(request: NextRequest) {
  const evt = newEvent('GET /api/print/log/recent');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const limitParam = request.nextUrl.searchParams.get('limit');
    const limit = Math.min(
      Math.max(parseInt(limitParam ?? `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );
    evt.set('limit', limit);

    const { data, error } = await supabase
      .from('print_events')
      .select('id, tx_id, daily_seq, target, trigger, outcome, failure_note, url_scheme_variant, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    evt.set('rows_count', data?.length ?? 0);
    tagStatus(evt, 200);
    return NextResponse.json({ events: data ?? [] });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
