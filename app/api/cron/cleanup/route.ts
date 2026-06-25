import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { newEvent, tagStatus } from '@/lib/logger';

const STORAGE_BUCKET = 'notas';
const RETENTION_DAYS = 7;

export async function GET(request: NextRequest) {
  const evt = newEvent('GET /api/cron/cleanup');
  try {
    const authHeader = request.headers.get('authorization') ?? '';
    const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`;
    if (!process.env.CRON_SECRET || authHeader !== expected) {
      tagStatus(evt, 401);
      evt.set('reject_reason', 'invalid_cron_token');
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000).toISOString();
    evt.set('cutoff', cutoff);

    const supabase = getSupabaseAdmin();
    const { data: targets, error: selectError } = await supabase
      .from('transactions')
      .select('id, scan_image_path')
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoff);

    if (selectError) {
      tagStatus(evt, 500);
      evt.error(selectError);
      return NextResponse.json({ error: selectError.message }, { status: 500 });
    }

    const ids = (targets ?? []).map((t) => t.id);
    const paths = (targets ?? []).map((t) => t.scan_image_path).filter((p): p is string => !!p);
    evt.merge({ targets_count: ids.length, storage_paths_count: paths.length });

    if (paths.length > 0) {
      const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove(paths);
      if (storageError) {
        evt.warn(`storage_cleanup_partial: ${storageError.message}`);
      }
    }

    if (ids.length > 0) {
      const { error: deleteError } = await supabase
        .from('transactions')
        .delete()
        .in('id', ids);
      if (deleteError) {
        tagStatus(evt, 500);
        evt.error(deleteError);
        return NextResponse.json({ error: deleteError.message }, { status: 500 });
      }
    }

    // — TAMBAHAN: cleanup print_queue done/failed > 7 hari —
    const { count: queueDeletedCount, error: queueDeleteErr } = await supabase
      .from('print_queue')
      .delete({ count: 'exact' })
      .in('status', ['done', 'failed'])
      .lt('created_at', cutoff);
    if (queueDeleteErr) {
      evt.warn(`print_queue cleanup error: ${queueDeleteErr.message}`);
    } else {
      evt.set('print_queue_deleted', queueDeletedCount ?? 0);
    }

    // — TAMBAHAN Phase 2: cleanup print_history > 7 hari —
    // History selalu final state (done/failed) — no pending. Hapus apa pun > 7 hari.
    const { count: historyDeletedCount, error: historyDeleteErr } = await supabase
      .from('print_history')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff);
    if (historyDeleteErr) {
      evt.warn(`print_history cleanup error: ${historyDeleteErr.message}`);
    } else {
      evt.set('print_history_deleted', historyDeletedCount ?? 0);
    }

    tagStatus(evt, 200);
    return NextResponse.json({ deleted_count: ids.length });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
