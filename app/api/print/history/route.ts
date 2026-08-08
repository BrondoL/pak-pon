import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const evt = newEvent('GET /api/print/history');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 200);
    const statusFilter = searchParams.get('status'); // 'pending' | 'done' | 'failed' | null
    const txFilter = searchParams.get('tx_id');

    let query = supabase
      .from('print_history')
      .select('id, tx_id, agent_label, target, trigger, status, failure_reason, created_at, printing_at, done_at, failed_at, transactions(customer_name, table_no, daily_seq)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (statusFilter === 'pending' || statusFilter === 'done' || statusFilter === 'failed') {
      query = query.eq('status', statusFilter);
    }
    if (txFilter) {
      query = query.eq('tx_id', txFilter);
    }

    const { data, error } = await query;
    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    type Row = {
      id: string;
      tx_id: string | null;
      agent_label: string | null;
      target: string;
      trigger: string;
      status: string;
      failure_reason: string | null;
      created_at: string;
      printing_at: string | null;
      done_at: string | null;
      failed_at: string | null;
      transactions: { customer_name: string | null; table_no: string | null; daily_seq: number | null } | null;
    };

    const rows = (data ?? []).map((row) => {
      const r = row as unknown as Row;
      const tx = r.transactions;
      return {
        id: r.id,
        tx_id: r.tx_id,
        agent_label: r.agent_label,
        target: r.target,
        trigger: r.trigger,
        status: r.status,
        failure_reason: r.failure_reason,
        created_at: r.created_at,
        printing_at: r.printing_at,
        done_at: r.done_at,
        failed_at: r.failed_at,
        customer_name: tx?.customer_name,
        table_no: tx?.table_no,
        daily_seq: tx?.daily_seq,
      };
    });

    evt.merge({ rows_count: rows.length });
    tagStatus(evt, 200);
    return NextResponse.json({ jobs: rows });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
