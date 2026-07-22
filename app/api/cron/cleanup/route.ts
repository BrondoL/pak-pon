import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { newEvent, tagStatus } from '@/lib/logger';
import { buildScanImagePurge } from '@/lib/transactions';

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

    // Cleanup print_history > 7 hari. Filter murni umur (created_at), lepas
    // dari status — row apa pun (done/failed, atau pending/printing yg somehow
    // nyangkut >7 hari) dihapus.
    const { count: historyDeletedCount, error: historyDeleteErr } = await supabase
      .from('print_history')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff);
    if (historyDeleteErr) {
      evt.warn(`print_history cleanup error: ${historyDeleteErr.message}`);
    } else {
      evt.set('print_history_deleted', historyDeletedCount ?? 0);
    }

    // Pass-3: purge foto nota transaksi >7 hari TANPA hapus transaksinya.
    // Filter umur transaksi (created_at < cutoff), BUKAN deleted_at seperti pass-1.
    // Bucket sama (notas), cutoff sama (7 hari). Batch loop cegah PostgREST 1000-row
    // cap. Idempoten: begitu scan_image_path di-NULL-kan, baris tidak match lagi.
    const nowIso = new Date().toISOString();
    let photosPurged = 0;
    for (;;) {
      const { data: photoBatch, error: photoSelectError } = await supabase
        .from('transactions')
        .select('id, scan_image_path')
        .not('scan_image_path', 'is', null)
        .lt('created_at', cutoff)
        .order('created_at', { ascending: true })
        .limit(CHUNK);

      if (photoSelectError) {
        evt.warn(`photo_purge_select error: ${photoSelectError.message}`);
        break;
      }
      if (!photoBatch || photoBatch.length === 0) break;

      const photoIds = photoBatch.map((t) => t.id);
      const photoPaths = photoBatch
        .map((t) => t.scan_image_path)
        .filter((p): p is string => !!p);

      if (photoPaths.length > 0) {
        const { error: photoStorageError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .remove(photoPaths);
        if (photoStorageError) {
          evt.warn(`photo_purge_storage_partial: ${photoStorageError.message}`);
        }
      }

      // Tetap update DB walau storage.remove partial-fail: hindari retry foto sama
      // tiap hari. purged_at menandai foto sudah dibuang (badge riwayat pakai ini).
      const { error: photoUpdateError } = await supabase
        .from('transactions')
        .update(buildScanImagePurge(nowIso))
        .in('id', photoIds);
      if (photoUpdateError) {
        evt.warn(`photo_purge_update error: ${photoUpdateError.message}`);
        break;
      }

      photosPurged += photoIds.length;
      if (photoBatch.length < CHUNK) break;
    }
    evt.set('photos_purged_count', photosPurged);

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
