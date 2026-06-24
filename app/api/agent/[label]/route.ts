import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ label: string }> },
) {
  const { label } = await params;
  const evt = newEvent('DELETE /api/agent/[label]', { agent_label: label });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const { error, count } = await supabase
      .from('agent_heartbeats')
      .delete({ count: 'exact' })
      .eq('agent_label', label);

    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    evt.set('deleted_count', count ?? 0);
    if ((count ?? 0) === 0) {
      tagStatus(evt, 404);
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
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
