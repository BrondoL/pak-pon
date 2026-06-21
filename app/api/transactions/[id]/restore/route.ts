import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';

const NOT_FOUND_CODE = 'PGRST116';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const evt = newEvent('POST /api/transactions/[id]/restore', { tx_id: id });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    // Only restore rows that are actually soft-deleted. The `.not('deleted_at', 'is', null)`
    // guard means restoring an already-live row returns 404 (no-op) instead of a stealth update.
    const { error } = await supabase
      .from('transactions')
      .update({ deleted_at: null })
      .eq('id', id)
      .not('deleted_at', 'is', null)
      .select('id')
      .single();

    if (error) {
      if (error.code === NOT_FOUND_CODE) {
        tagStatus(evt, 404);
        evt.set('reject_reason', 'not_found_or_not_deleted');
        return NextResponse.json({ error: 'not_found_or_not_deleted' }, { status: 404 });
      }
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    tagStatus(evt, 200);
    return NextResponse.json({ ok: true });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
