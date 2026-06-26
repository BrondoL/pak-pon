import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import { AgentPatchSchema } from './_schema';

// Identitas agent: row PK (uuid). Sebelumnya pakai agent_label tapi label
// boleh duplikat di schema (UNIQUE dipindah ke agent_uuid di retrofit 0011a).
// Reinstall app -> agent_uuid baru, label sama -> 2 row dengan label sama.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const evt = newEvent('DELETE /api/agent/[id]', { agent_id: id });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    if (!isUuid(id)) {
      tagStatus(evt, 400);
      return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
    }

    // Protect primary: kalau target = primary AND masih ada agent lain,
    // tolak sampai owner pindahin primary dulu. Kalau ini satu-satunya
    // agent, delete OK (fresh state, primary kosong). Soft-guard: lookup
    // + count + delete bukan transaksi. Single-owner POS, race window
    // praktis nol — kalau jadi masalah, convert ke RPC atomic.
    const { data: target, error: lookupErr } = await supabase
      .from('agent_heartbeats')
      .select('is_primary, agent_label')
      .eq('id', id)
      .maybeSingle();
    if (lookupErr) {
      tagStatus(evt, 500);
      evt.error(lookupErr);
      return NextResponse.json({ error: lookupErr.message }, { status: 500 });
    }
    if (target?.agent_label) {
      evt.set('agent_label', target.agent_label);
    }
    if (target?.is_primary) {
      const { count: othersCount, error: countErr } = await supabase
        .from('agent_heartbeats')
        .select('id', { count: 'exact', head: true })
        .neq('id', id);
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
      .eq('id', id);

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
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const evt = newEvent('PATCH /api/agent/[id]', { agent_id: id });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    if (!isUuid(id)) {
      tagStatus(evt, 400);
      return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
    }

    const body = await request.json();
    const parsed = AgentPatchSchema.safeParse(body);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ validation_errors: parsed.error.flatten() });
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }

    const { data: target, error: lookupErr } = await supabase
      .from('agent_heartbeats')
      .select('id, agent_label, is_primary')
      .eq('id', id)
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
    evt.set('agent_label', target.agent_label);

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

    evt.set('new_primary_label', target.agent_label);
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
