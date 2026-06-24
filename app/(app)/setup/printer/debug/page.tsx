'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

type Job = {
  id: string;
  tx_id: string | null;
  target: 'dapur' | 'minuman';
  trigger: 'auto' | 'reprint' | 'test';
  status: 'pending' | 'printing' | 'done' | 'failed';
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
  customer_name: string | null;
  table_no: string | null;
  daily_seq: number | null;
  agent_label: string | null;
};

function formatTxLabel(j: Job): string {
  if (j.trigger === 'test') return '(test print)';
  const parts: string[] = [];
  if (j.daily_seq != null) parts.push(`#${String(j.daily_seq).padStart(4, '0')}`);
  if (j.table_no) parts.push(`Meja ${j.table_no}`);
  if (j.customer_name) parts.push(j.customer_name);
  return parts.length > 0 ? parts.join(' · ') : '-';
}

type Agent = {
  agent_label: string;
  last_seen_at: string;
  agent_version: string | null;
  device_info: string | null;
  online: boolean;
};

export default function PrinterDebugPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const [agentRes, jobsRes] = await Promise.all([
        fetch('/api/agent/heartbeat'),
        fetch('/api/print/queue/recent?limit=30'),
      ]);
      if (!agentRes.ok) throw new Error(`agent HTTP ${agentRes.status}`);
      if (!jobsRes.ok) throw new Error(`jobs HTTP ${jobsRes.status}`);
      const agentData = await agentRes.json();
      const jobsData = await jobsRes.json();
      setAgents(agentData.agents as Agent[]);
      setJobs(jobsData.jobs as Job[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, []);

  async function retryJob(jobId: string) {
    const res = await fetch(`/api/print/queue/${jobId}/retry`, { method: 'POST' });
    if (res.ok) {
      toast.success('Job di-retry — agent akan pick up lagi');
      reload();
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(`Gagal retry: ${data.error ?? `HTTP ${res.status}`}`);
    }
  }

  async function deleteAgent(label: string) {
    const res = await fetch(`/api/agent/${encodeURIComponent(label)}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success(`Agent "${label}" dihapus`);
      reload();
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(`Gagal hapus: ${data.error ?? `HTTP ${res.status}`}`);
    }
  }

  const pending = jobs.filter((j) => j.status === 'pending' || j.status === 'printing');
  const recent = jobs.filter((j) => j.status === 'done' || j.status === 'failed');

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-coal">Printer Diagnostic</h1>
        <Button type="button" variant="secondary" onClick={reload} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      {error && <p className="text-sm text-brick-dark">Error: {error}</p>}

      <section className="space-y-2">
        <h2 className="text-lg font-medium text-coal">Agent Status</h2>
        {agents.length === 0 && (
          <p className="text-sm text-coal-soft">Belum ada agent registered.</p>
        )}
        {agents.map((a) => (
          <div
            key={a.agent_label}
            className="flex items-center justify-between gap-3 rounded-md border border-clay-soft bg-paper-soft p-3"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-coal">{a.agent_label}</p>
              <p className="text-xs text-coal-soft">
                Last seen: {new Date(a.last_seen_at).toLocaleString('id-ID')}
                {a.agent_version && ` · v${a.agent_version}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  a.online ? 'bg-leaf text-white' : 'bg-brick text-white'
                }`}
              >
                {a.online ? 'Online' : 'Offline'}
              </span>
              <AlertDialog>
                <AlertDialogTrigger
                  aria-label={`Hapus agent ${a.agent_label}`}
                  render={<Button type="button" variant="ghost" size="sm" />}
                >
                  Hapus
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Hapus agent &ldquo;{a.agent_label}&rdquo;?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Heartbeat akan hilang dari list. Kalau agent app masih jalan, dia akan muncul lagi pas heartbeat berikutnya — pakai ini buat cleanup row legacy atau agent yang udah ga dipakai.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteAgent(a.agent_label)}>
                      Ya, hapus
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium text-coal">Pending / In-progress ({pending.length})</h2>
        {pending.length === 0 && (
          <p className="text-sm text-coal-soft">Tidak ada job pending.</p>
        )}
        {pending.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-clay-soft">
                <th className="text-left p-2 text-coal">Time</th>
                <th className="text-left p-2 text-coal">Transaksi</th>
                <th className="text-left p-2 text-coal">Target</th>
                <th className="text-left p-2 text-coal">Trigger</th>
                <th className="text-left p-2 text-coal">Agent</th>
                <th className="text-left p-2 text-coal">Status</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((j) => (
                <tr key={j.id} className="border-b border-clay-soft">
                  <td className="p-2 text-coal">{new Date(j.created_at).toLocaleString('id-ID')}</td>
                  <td className="p-2 text-coal">{formatTxLabel(j)}</td>
                  <td className="p-2 text-coal">{j.target}</td>
                  <td className="p-2 text-coal">{j.trigger}</td>
                  <td className="p-2 text-coal-soft">{j.agent_label ?? '-'}</td>
                  <td className="p-2 text-coal">{j.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium text-coal">Recent Jobs ({recent.length})</h2>
        {recent.length === 0 && (
          <p className="text-sm text-coal-soft">Belum ada job done/failed.</p>
        )}
        {recent.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-clay-soft">
                <th className="text-left p-2 text-coal">Time</th>
                <th className="text-left p-2 text-coal">Transaksi</th>
                <th className="text-left p-2 text-coal">Target</th>
                <th className="text-left p-2 text-coal">Agent</th>
                <th className="text-left p-2 text-coal">Status</th>
                <th className="text-left p-2 text-coal">Reason</th>
                <th className="text-left p-2 text-coal">Action</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((j) => (
                <tr key={j.id} className="border-b border-clay-soft">
                  <td className="p-2 text-coal">{new Date(j.created_at).toLocaleString('id-ID')}</td>
                  <td className="p-2 text-coal">{formatTxLabel(j)}</td>
                  <td className="p-2 text-coal">{j.target}</td>
                  <td className="p-2 text-coal-soft">{j.agent_label ?? '-'}</td>
                  <td className="p-2">
                    <span className={j.status === 'done' ? 'text-leaf' : 'text-brick'}>
                      {j.status}
                    </span>
                  </td>
                  <td className="p-2 text-coal-soft">{j.failure_reason ?? '-'}</td>
                  <td className="p-2">
                    {j.status === 'failed' && (
                      <button
                        onClick={() => retryJob(j.id)}
                        className="rounded border border-brick-soft px-2 py-0.5 text-xs text-brick"
                      >
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
