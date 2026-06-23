import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import { PrintLogSchema } from './_schema';

export async function POST(request: NextRequest) {
  const evt = newEvent('POST /api/print/log');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const body = await request.json();
    const parsed = PrintLogSchema.safeParse(body);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ validation_errors: parsed.error.flatten() });
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }

    const payload = parsed.data;
    evt.merge({
      tx_id: payload.tx_id,
      daily_seq: payload.daily_seq,
      target: payload.target,
      trigger: payload.trigger,
      outcome: payload.outcome,
      url_scheme_variant: payload.url_scheme_variant,
      failure_note: payload.failure_note,
    });

    // Persist subset ke print_events table untuk diagnostic page
    const { error: insertErr } = await supabase
      .from('print_events')
      .insert({
        tx_id: payload.tx_id, // null untuk test print, valid uuid untuk auto/reprint
        daily_seq: payload.daily_seq,
        target: payload.target,
        trigger: payload.trigger,
        outcome: payload.outcome,
        failure_note: payload.failure_note ?? null,
        url_scheme_variant: payload.url_scheme_variant ?? null,
        user_agent: payload.user_agent ?? null,
        user_id: user.id,
      });
    if (insertErr) {
      tagStatus(evt, 500);
      evt.error(insertErr);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    tagStatus(evt, 204);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
