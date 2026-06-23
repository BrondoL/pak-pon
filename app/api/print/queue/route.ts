import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import { PrintQueueInsertSchema } from './_schema';

export async function POST(request: NextRequest) {
  const evt = newEvent('POST /api/print/queue');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const body = await request.json();
    const parsed = PrintQueueInsertSchema.safeParse(body);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ validation_errors: parsed.error.flatten() });
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }

    const payload = parsed.data;
    evt.merge({
      tx_id: payload.tx_id,
      target: payload.target,
      trigger: payload.trigger,
      bytes_size: payload.bytes_b64.length,
    });

    const { data: inserted, error: insertErr } = await supabase
      .from('print_queue')
      .insert({
        tx_id: payload.tx_id,
        target: payload.target,
        trigger: payload.trigger,
        bytes_b64: payload.bytes_b64,
        created_by: user.id,
      })
      .select('id')
      .single();
    if (insertErr) {
      tagStatus(evt, 500);
      evt.error(insertErr);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    evt.set('job_id', inserted.id);
    tagStatus(evt, 201);
    return NextResponse.json({ job_id: inserted.id }, { status: 201 });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
