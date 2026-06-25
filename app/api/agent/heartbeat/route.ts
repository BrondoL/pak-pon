import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';

// 90s = heartbeat 30s × 3 ticks toleransi (sesuai spec 2.3).
const ONLINE_THRESHOLD_MS = 90 * 1000;

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
      .select('agent_label, last_seen_at, agent_version, device_info, status')
      .order('last_seen_at', { ascending: false });
    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const now = Date.now();
    const agents = (data ?? []).map((a) => ({
      agent_label: a.agent_label,
      last_seen_at: a.last_seen_at,
      agent_version: a.agent_version,
      device_info: a.device_info,
      status: a.status,
      // Online: status='online' AND heartbeat recent. Either condition alone
      // is insufficient — stale status='online' (crash) or fresh heartbeat
      // tanpa start (legacy build) both = false.
      online: a.status === 'online' && now - new Date(a.last_seen_at).getTime() < ONLINE_THRESHOLD_MS,
    }));
    evt.merge({ agents_count: agents.length, online_count: agents.filter((a) => a.online).length });

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
