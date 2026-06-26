import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { newEvent, tagStatus } from '@/lib/logger';

const STALE_PENDING_MINUTES = 5;

export async function GET(request: NextRequest) {
  const evt = newEvent('GET /api/cron/print-sweep');
  try {
    const authHeader = request.headers.get('authorization') ?? '';
    const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`;
    if (!process.env.CRON_SECRET || authHeader !== expected) {
      tagStatus(evt, 401);
      evt.set('reject_reason', 'invalid_cron_token');
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const cutoff = new Date(Date.now() - STALE_PENDING_MINUTES * 60 * 1000).toISOString();
    evt.set('cutoff', cutoff);

    const supabase = getSupabaseAdmin();
    const { count: timeoutCount, error: timeoutErr } = await supabase
      .from('print_history')
      .update({
        status: 'failed',
        failure_reason: 'timeout: agent did not ack',
        failed_at: new Date().toISOString(),
      }, { count: 'exact' })
      .eq('status', 'pending')
      .lt('created_at', cutoff);

    if (timeoutErr) {
      tagStatus(evt, 500);
      evt.error(timeoutErr);
      return NextResponse.json({ error: timeoutErr.message }, { status: 500 });
    }

    evt.set('pending_timeout_count', timeoutCount ?? 0);
    tagStatus(evt, 200);
    return NextResponse.json({ timeout_count: timeoutCount ?? 0 });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
