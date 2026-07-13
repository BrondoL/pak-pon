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

    // Chunked loop: cegah PostgREST 1000-row cap silently truncate backlog
    // (mis. owner bulk-delete banyak transaksi kena retention window sama).
    // Setiap iterasi: select 1 batch → hapus storage → hapus DB → ulang sampai kosong.
    const CHUNK = 500;
    let totalIds = 0;
    let totalPaths = 0;
    for (;;) {
      const { data: batch, error: selectError } = await supabase
        .from('transactions')
        .select('id, scan_image_path')
        .not('deleted_at', 'is', null)
        .lt('deleted_at', cutoff)
        .order('deleted_at', { ascending: true })
        .limit(CHUNK);

      if (selectError) {
        tagStatus(evt, 500);
        evt.error(selectError);
        return NextResponse.json({ error: selectError.message }, { status: 500 });
      }

      if (!batch || batch.length === 0) break;

      const batchIds = batch.map((t) => t.id);
      const batchPaths = batch.map((t) => t.scan_image_path).filter((p): p is string => !!p);

      if (batchPaths.length > 0) {
        const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove(batchPaths);
        if (storageError) {
          evt.warn(`storage_cleanup_partial: ${storageError.message}`);
        }
      }

      const { error: deleteError } = await supabase
        .from('transactions')
        .delete()
        .in('id', batchIds);
      if (deleteError) {
        tagStatus(evt, 500);
        evt.error(deleteError);
        return NextResponse.json({ error: deleteError.message }, { status: 500 });
      }

      totalIds += batchIds.length;
      totalPaths += batchPaths.length;

      if (batch.length < CHUNK) break;
    }
    evt.merge({ targets_count: totalIds, storage_paths_count: totalPaths });

    // Cleanup print_history > 7 hari. History selalu final state
    // (done/failed) — no pending. Hapus apa pun > 7 hari.
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
    return NextResponse.json({ deleted_count: totalIds });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
