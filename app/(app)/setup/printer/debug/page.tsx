'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { computeJobDuration, formatDuration } from '@/lib/print-duration';
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
  status: 'pending' | 'printing' | 'done' | 'failed';
  failure_reason: string | null;
  created_at: string;
  printing_at: string | null;
  done_at: string | null;
  failed_at: string | null;
  claimed_via: 'fcm' | 'poll' | null;
  receive_to_claim_ms: number | null;
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

/**
 * Durasi job + pecahan ruasnya.
 * - `fcm`   = pesan berjalan dari server ke tablet
 * - `agent` = tablet memproses (cek sesi + klaim ke Supabase)
 * - `cetak` = socket ke printer sampai selesai
 *
 * Badge `poll` berarti FCM TIDAK pernah sampai dan job dipungut poller 60
 * detik — kehadirannya sendiri adalah gejala, bukan sekadar info. Untuk baris
 * itu ruas `fcm` tidak ditampilkan: tidak ada perjalanan yang bisa diukur.
 */
function DurationView({ job }: { job: Job }) {
  const d = computeJobDuration(job);
  if (!d) return <span className="text-coal-soft">—</span>;

  const parts: string[] = [];
  // Guard positif: fcm segment hanya valid untuk baris FCM-klaim, bukan
  // "semua yang bukan poll". Baris lama (`claimed_via = null`) tetap tidak
  // mencapai branch ini karena `deliverMs = null`.
  if (d.claimedVia === 'fcm' && d.deliverMs !== null) {
    parts.push(`fcm ${formatDuration(d.deliverMs)}`);
  }
  if (d.agentMs !== null) parts.push(`agent ${formatDuration(d.agentMs)}`);
  // Baris lama (belum punya kolom klaim) tetap tampil seperti sebelumnya.
  if (d.agentMs === null && d.sendMs !== null) parts.push(`kirim ${formatDuration(d.sendMs)}`);
  if (d.printMs !== null) parts.push(`cetak ${formatDuration(d.printMs)}`);

  return (
    <div>
      <div className="flex items-baseline gap-1">
        <span className={d.isSlow ? 'font-medium text-brick' : 'text-coal'}>
          {formatDuration(d.totalMs)}
        </span>
        {d.claimedVia === 'poll' && (
          <span className="rounded-full bg-brick/15 px-1.5 text-[10px] font-medium uppercase tracking-wide text-brick">
            poll
          </span>
        )}
      </div>
      {parts.length > 0 && (
        <div className="text-[10px] text-coal-soft">{parts.join(' · ')}</div>
      )}
    </div>
  );
}

type DisplayState = 'online' | 'stale' | 'offline';

type Agent = {
  id: string;
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

  async function setPrimary(agent: Agent) {
    const res = await fetch(`/api/agent/${agent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_primary: true }),
    });
    if (res.ok) {
      toast.success(`${agent.agent_label} sekarang primary`);
      reload();
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(`Gagal set primary: ${data.detail ?? data.error ?? `HTTP ${res.status}`}`);
    }
  }

  async function deleteAgent(agent: Agent) {
    const res = await fetch(`/api/agent/${agent.id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success(`Agent "${agent.agent_label}" dihapus`);
      reload();
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(`Gagal hapus: ${data.error ?? `HTTP ${res.status}`}`);
    }
  }

  const pending = jobs.filter((j) => j.status === 'pending');
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
            key={a.id}
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
                      <AlertDialogAction onClick={() => setPrimary(a)}>
                        Ya, jadikan primary
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
                    <AlertDialogAction onClick={() => deleteAgent(a)}>
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
          Pending: {pending.length} · Failed: {failed.length} · Done: {done.length}.
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
                          : j.status === 'pending' || j.status === 'printing'
                          ? 'bg-mustard/20 text-coal'
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
                  <div className="mt-1 flex items-baseline gap-1 text-coal-soft">
                    <span>Durasi:</span>
                    <DurationView job={j} />
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
                    <th className="p-2 text-left text-coal">Durasi</th>
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
                        <span className={
                          j.status === 'done' ? 'text-leaf' :
                          j.status === 'pending' || j.status === 'printing' ? 'text-coal-soft' :
                          'text-brick'
                        }>
                          {j.status}
                        </span>
                      </td>
                      <td className="p-2"><DurationView job={j} /></td>
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
