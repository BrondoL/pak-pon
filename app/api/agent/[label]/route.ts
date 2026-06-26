import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import { AgentPatchSchema } from './_schema';

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

    // Protect primary: kalau target = primary AND masih ada agent lain,
    // tolak sampai owner pindahin primary dulu. Kalau ini satu-satunya
    // agent, delete OK (fresh state, primary kosong). Soft-guard: lookup
    // + count + delete bukan transaksi. Single-owner POS, race window
    // praktis nol — kalau jadi masalah, convert ke RPC atomic.
    const { data: target, error: lookupErr } = await supabase
      .from('agent_heartbeats')
      .select('is_primary')
      .eq('agent_label', label)
      .maybeSingle();
    if (lookupErr) {
      tagStatus(evt, 500);
      evt.error(lookupErr);
      return NextResponse.json({ error: lookupErr.message }, { status: 500 });
    }
    if (target?.is_primary) {
      const { count: othersCount, error: countErr } = await supabase
        .from('agent_heartbeats')
        .select('id', { count: 'exact', head: true })
        .neq('agent_label', label);
      if (countErr) {
        tagStatus(evt, 500);
        evt.error(countErr);
        return NextResponse.json({ error: countErr.message }, { status: 500 });
      }
      if ((othersCount ?? 0) > 0) {
        tagStatus(evt, 409);
        evt.set('reject_reason', 'primary_in_use');
        return NextResponse.json(
          {
            error: 'primary_in_use',
            detail: 'Pindahkan primary ke agent lain sebelum hapus agent ini.',
          },
          { status: 409 },
        );
      }
    }

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ label: string }> },
) {
  const { label } = await params;
  const evt = newEvent('PATCH /api/agent/[label]', { agent_label: label });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const body = await request.json();
    const parsed = AgentPatchSchema.safeParse(body);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ validation_errors: parsed.error.flatten() });
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }

    const { data: target, error: lookupErr } = await supabase
      .from('agent_heartbeats')
      .select('id, is_primary')
      .eq('agent_label', label)
      .maybeSingle();
    if (lookupErr) {
      tagStatus(evt, 500);
      evt.error(lookupErr);
      return NextResponse.json({ error: lookupErr.message }, { status: 500 });
    }
    if (!target) {
      tagStatus(evt, 404);
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    if (target.is_primary) {
      tagStatus(evt, 200);
      evt.set('already_primary', true);
      return NextResponse.json({ ok: true, already_primary: true });
    }

    // Atomic swap via RPC. Tanpa ini, 2 UPDATE non-transactional dari sisi
    // klien bisa hit partial unique index di tengah window.
    const { error: rpcErr } = await supabase.rpc('set_primary_agent', {
      target_id: target.id,
    });
    if (rpcErr) {
      tagStatus(evt, 500);
      evt.error(rpcErr);
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }

    evt.set('new_primary_label', label);
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
