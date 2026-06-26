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
  target: 'dapur' | 'minuman' | 'customer';
  trigger: 'auto' | 'auto_additional' | 'reprint' | 'reprint_additional' | 'customer' | 'test';
  status: 'done' | 'failed';
  failure_reason: string | null;
  created_at: string;
  done_at: string | null;
  failed_at: string | null;
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

type DisplayState = 'online' | 'stale' | 'offline';

type Agent = {
  agent_label: string;
  last_seen_at: string;
  agent_version: string | null;
  device_info: string | null;
  status: string;
  display_state: DisplayState;
  online: boolean;
  is_primary: boolean;
};

function badgeClassesFor(state: DisplayState): string {
  if (state === 'online') return 'bg-leaf text-white';
  if (state === 'stale') return 'bg-mustard text-coal';
  return 'bg-brick text-white';
}

function badgeLabelFor(state: DisplayState): string {
  if (state === 'online') return 'Online';
  if (state === 'stale') return 'Stale';
  return 'Offline';
}

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
        fetch('/api/print/history?limit=30'),
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

  async function setPrimary(label: string) {
    const res = await fetch(`/api/agent/${encodeURIComponent(label)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_primary: true }),
    });
    if (res.ok) {
      toast.success(`${label} sekarang primary`);
      reload();
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(`Gagal set primary: ${data.detail ?? data.error ?? `HTTP ${res.status}`}`);
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

  // print_history hanya punya final states (done/failed). Tidak ada pending
  // karena agent insert setelah job selesai.
  const done = jobs.filter((j) => j.status === 'done');
  const failed = jobs.filter((j) => j.status === 'failed');

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-coal sm:text-2xl">Printer Diagnostic</h1>
        <Button
          type="button"
          variant="secondary"
          onClick={reload}
          disabled={loading}
          className="self-start sm:self-auto"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      {error && <p className="text-sm text-brick-dark">Error: {error}</p>}

      <section className="space-y-2">
        <h2 className="text-base font-medium text-coal sm:text-lg">Agent Status</h2>
        {agents.length === 0 && (
          <p className="text-sm text-coal-soft">Belum ada agent registered.</p>
        )}
        {agents.length > 0 && !agents.some((a) => a.is_primary) && (
          <div className="rounded-md border border-brick-soft bg-brick-faint p-3 text-sm text-brick-dark">
            <p className="font-medium">Belum ada primary agent</p>
            <p>
              Print tidak akan jalan sampai owner pilih satu agent sebagai primary.
              Klik &ldquo;Jadikan Primary&rdquo; pada salah satu agent di bawah.
            </p>
          </div>
        )}
        {agents.map((a) => (
          <div
            key={a.agent_label}
            className="flex flex-col gap-2 rounded-md border border-clay-soft bg-paper-soft p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate font-medium text-coal">{a.agent_label}</p>
                {a.is_primary && (
                  <span className="shrink-0 rounded-full bg-coal px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-paper">
                    Primary
                  </span>
                )}
              </div>
              <p className="text-xs text-coal-soft">
                Last seen: {new Date(a.last_seen_at).toLocaleString('id-ID')}
                {a.agent_version && ` · v${a.agent_version}`}
              </p>
            </div>
            <div className="flex items-center justify-between gap-2 sm:justify-end">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeClassesFor(a.display_state)}`}
              >
                {badgeLabelFor(a.display_state)}
              </span>
              {!a.is_primary && (
                <AlertDialog>
                  <AlertDialogTrigger
                    aria-label={`Jadikan primary ${a.agent_label}`}
                    render={<Button type="button" variant="outline" size="sm" />}
                  >
                    Jadikan Primary
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Ganti primary agent ke &ldquo;{a.agent_label}&rdquo;?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Semua nota akan dikirim ke device ini. Pastikan device aktif dan printer-nya
                        sudah benar di-set.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Batal</AlertDialogCancel>
                      <AlertDialogAction onClick={() => setPrimary(a.agent_label)}>
                        Set Primary
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
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
        <h2 className="text-base font-medium text-coal sm:text-lg">
          Job History ({jobs.length})
        </h2>
        <p className="text-xs text-coal-soft">
          Failed: {failed.length} · Done: {done.length}.
          {failed.length > 0 && ' Untuk retry, buka agent app → tab History.'}
        </p>
        {jobs.length === 0 && (
          <p className="text-sm text-coal-soft">Belum ada job di history.</p>
        )}
        {jobs.length > 0 && (
          <>
            <ul className="space-y-2 md:hidden">
              {jobs.map((j) => (
                <li
                  key={j.id}
                  className="rounded-md border border-clay-soft bg-paper-soft p-3 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-coal">{formatTxLabel(j)}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        j.status === 'done'
                          ? 'bg-leaf/15 text-leaf'
                          : 'bg-brick/15 text-brick'
                      }`}
                    >
                      {j.status}
                    </span>
                  </div>
                  <div className="mt-1 text-coal-soft">
                    {new Date(j.created_at).toLocaleString('id-ID')}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-coal-soft">
                    <span>
                      Target: <span className="text-coal">{j.target}</span>
                    </span>
                    <span>
                      Trigger: <span className="text-coal">{j.trigger}</span>
                    </span>
                    <span>
                      Agent: <span className="text-coal">{j.agent_label ?? '-'}</span>
                    </span>
                  </div>
                  {j.failure_reason && (
                    <div className="mt-1 break-words text-coal-soft">
                      Reason: <span className="text-coal">{j.failure_reason}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-clay-soft">
                    <th className="p-2 text-left text-coal">Time</th>
                    <th className="p-2 text-left text-coal">Transaksi</th>
                    <th className="p-2 text-left text-coal">Target</th>
                    <th className="p-2 text-left text-coal">Trigger</th>
                    <th className="p-2 text-left text-coal">Agent</th>
                    <th className="p-2 text-left text-coal">Status</th>
                    <th className="p-2 text-left text-coal">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className="border-b border-clay-soft">
                      <td className="p-2 text-coal">{new Date(j.created_at).toLocaleString('id-ID')}</td>
                      <td className="p-2 text-coal">{formatTxLabel(j)}</td>
                      <td className="p-2 text-coal">{j.target}</td>
                      <td className="p-2 text-coal-soft">{j.trigger}</td>
                      <td className="p-2 text-coal-soft">{j.agent_label ?? '-'}</td>
                      <td className="p-2">
                        <span className={j.status === 'done' ? 'text-leaf' : 'text-brick'}>
                          {j.status}
                        </span>
                      </td>
                      <td className="p-2 text-coal-soft">{j.failure_reason ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
