import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';

// 3-state agent display:
// - online: status='online' AND heartbeat segar (< 1 jam)
// - stale:  status='online' AND heartbeat >= 1 jam (kemungkinan ke-freeze OEM,
//           tapi FCM still bisa wake — dispatch route tetap kirim)
// - offline: status='offline' (user pencet Stop, atau belum start sama sekali)
const STALE_THRESHOLD_MS = 60 * 60 * 1000;

type DisplayState = 'online' | 'stale' | 'offline';

function computeDisplayState(status: string, lastSeenMs: number, nowMs: number): DisplayState {
  if (status !== 'online') return 'offline';
  return nowMs - lastSeenMs >= STALE_THRESHOLD_MS ? 'stale' : 'online';
}

export async function GET() {
  const evt = newEvent('GET /api/agent/heartbeat');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const { data, error } = await supabase
      .from('agent_heartbeats')
      .select('id, agent_label, last_seen_at, agent_version, device_info, status, is_primary')
      .order('last_seen_at', { ascending: false });
    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const now = Date.now();
    const agents = (data ?? []).map((a) => {
      const display_state = computeDisplayState(
        a.status,
        new Date(a.last_seen_at).getTime(),
        now,
      );
      return {
        id: a.id,
        agent_label: a.agent_label,
        last_seen_at: a.last_seen_at,
        agent_version: a.agent_version,
        device_info: a.device_info,
        status: a.status,
        is_primary: a.is_primary,
        display_state,
        // Backward-compat: `online` true cuma kalau benar-benar segar.
        // Banner / debug page sekarang pakai display_state.
        online: display_state === 'online',
      };
    });
    const primary = agents.find((a) => a.is_primary);
    evt.merge({
      agents_count: agents.length,
      online_count: agents.filter((a) => a.display_state === 'online').length,
      stale_count: agents.filter((a) => a.display_state === 'stale').length,
      offline_count: agents.filter((a) => a.display_state === 'offline').length,
      primary_label: primary?.agent_label ?? null,
      primary_display_state: primary?.display_state ?? null,
    });

    tagStatus(evt, 200);
    return NextResponse.json({ agents });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
