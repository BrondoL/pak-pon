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
    const nowIso = new Date().toISOString();

    // (a) pending stale = agent tidak pernah ack (FCM+poll dua-duanya gagal).
    const { count: timeoutCount, error: timeoutErr } = await supabase
      .from('print_history')
      .update({
        status: 'failed',
        failure_reason: 'timeout: agent did not ack',
        failed_at: nowIso,
      }, { count: 'exact' })
      .eq('status', 'pending')
      .lt('created_at', cutoff);

    if (timeoutErr) {
      tagStatus(evt, 500);
      evt.error(timeoutErr);
      return NextResponse.json({ error: timeoutErr.message }, { status: 500 });
    }

    // (b) printing stuck = agent klaim (status printing) tapi crash sebelum
    // finalize done/failed (mis. OS kill di tengah TCP send). Tanpa sweep ini
    // row stuck 'printing' selamanya — poller filter 'pending' jadi tidak
    // pernah fetch, tx tidak akan tercetak lagi. Cutoff 5 menit sangat longgar
    // vs TCP send (hitungan detik) → tidak akan salah-vonis print yang aktif.
    const { count: stuckPrintingCount, error: stuckErr } = await supabase
      .from('print_history')
      .update({
        status: 'failed',
        failure_reason: 'stuck: agent claimed but did not finalize',
        failed_at: nowIso,
      }, { count: 'exact' })
      .eq('status', 'printing')
      .lt('created_at', cutoff);

    if (stuckErr) {
      tagStatus(evt, 500);
      evt.error(stuckErr);
      return NextResponse.json({ error: stuckErr.message }, { status: 500 });
    }

    evt.set('pending_timeout_count', timeoutCount ?? 0);
    evt.set('stuck_printing_count', stuckPrintingCount ?? 0);
    tagStatus(evt, 200);
    return NextResponse.json({
      timeout_count: timeoutCount ?? 0,
      stuck_printing_count: stuckPrintingCount ?? 0,
    });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
