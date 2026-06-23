import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';

const NOT_FOUND_CODE = 'PGRST116';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const evt = newEvent('POST /api/print/queue/[id]/retry', { job_id: id });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const { data: job, error: fetchErr } = await supabase
      .from('print_queue')
      .select('id, status')
      .eq('id', id)
      .single();
    if (fetchErr) {
      if (fetchErr.code === NOT_FOUND_CODE) {
        tagStatus(evt, 404);
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
      tagStatus(evt, 500);
      evt.error(fetchErr);
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    evt.set('previous_status', job.status);
    if (job.status !== 'failed') {
      tagStatus(evt, 409);
      return NextResponse.json(
        { error: 'invalid_state', detail: `cannot retry job with status=${job.status}` },
        { status: 409 }
      );
    }

    const { data: updated, error: updateErr } = await supabase
      .from('print_queue')
      .update({
        status: 'pending',
        failure_reason: null,
        completed_at: null,
        picked_up_at: null,
      })
      .eq('id', id)
      .select('id, tx_id, target, trigger, status, failure_reason, created_at')
      .single();
    if (updateErr) {
      tagStatus(evt, 500);
      evt.error(updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    evt.set('new_status', updated.status);
    tagStatus(evt, 200);
    return NextResponse.json({ job: updated });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
