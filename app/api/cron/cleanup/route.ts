import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { newEvent, tagStatus } from '@/lib/logger';

const STORAGE_BUCKET = 'notas';
const RETENTION_DAYS = 7;

export async function POST(request: NextRequest) {
  const evt = newEvent('POST /api/cron/cleanup');
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
