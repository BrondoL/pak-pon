import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import { pushPrintJob } from '@/lib/fcm';
import { PrintSendSchema } from './_schema';

// Dispatch threshold = "agent kemungkinan masih reachable via FCM" — bukan
// "heartbeat fresh". OEM Doze/App Standby (HiOS, MIUI, ColorOS) freeze
// heartbeat thread, tapi Google Play Services tetap deliver FCM. Threshold
// 24 jam cukup longgar untuk semua case freeze realistis (tablet idle
// overnight), tetep filter agent yang truly dead (uninstall, ganti device).
// UI banner di /api/agent/heartbeat tetap pakai 90s untuk indikasi staleness.
const ONLINE_THRESHOLD_SECONDS = 24 * 60 * 60;

export async function POST(request: NextRequest) {
  const evt = newEvent('POST /api/print/send');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const body = await request.json();
    const parsed = PrintSendSchema.safeParse(body);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ validation_errors: parsed.error.flatten() });
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    const payload = parsed.data;

    const job_id = randomUUID();
    evt.merge({
      job_id,
      tx_id: payload.tx_id,
      target: payload.target,
      trigger: payload.trigger,
      bytes_size: payload.bytes_b64.length,
      item_ids_count: payload.item_ids?.length ?? 0,
    });

    // Find agents currently online (explicit state + recent heartbeat).
    const threshold = new Date(Date.now() - ONLINE_THRESHOLD_SECONDS * 1000).toISOString();
    const { data: agents, error: queryErr } = await supabase
      .from('agent_heartbeats')
      .select('agent_label, fcm_token')
      .eq('status', 'online')
      .gte('last_seen_at', threshold)
      .not('fcm_token', 'is', null);
    if (queryErr) {
      tagStatus(evt, 500);
      evt.error(queryErr);
      return NextResponse.json({ error: queryErr.message }, { status: 500 });
    }

    const targets = (agents ?? []).filter(
      (a): a is { agent_label: string; fcm_token: string } =>
        typeof a.fcm_token === 'string' && a.fcm_token.length > 0,
    );

    if (targets.length === 0) {
      tagStatus(evt, 503);
      evt.set('reject_reason', 'agent_offline');
      return NextResponse.json(
        { error: 'agent_offline', detail: 'no online agent available' },
        { status: 503 },
      );
    }
    evt.set('dispatched_to', targets.map((t) => t.agent_label));

    // Fire-and-forget FCM push. Cleanup invalid tokens on the side.
    pushPrintJob({
      tokens: targets.map((t) => t.fcm_token),
      job: {
        id: job_id,
        tx_id: payload.tx_id,
        target: payload.target,
        trigger: payload.trigger,
        item_ids: payload.item_ids,
        bytes_b64: payload.bytes_b64,
      },
    }).then(
      async (r) => {
        console.log(`[fcm] push ok=${r.ok} failed=${r.failed}`);
        if (r.invalidTokens.length > 0) {
          await supabase
            .from('agent_heartbeats')
            .update({ fcm_token: null })
            .in('fcm_token', r.invalidTokens);
          console.log(`[fcm] cleared ${r.invalidTokens.length} stale token(s)`);
        }
      },
      (e) => console.warn('[fcm] push error', e),
    );

    tagStatus(evt, 200);
    return NextResponse.json({
      job_id,
      dispatched_to: targets.map((t) => t.agent_label),
    });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
