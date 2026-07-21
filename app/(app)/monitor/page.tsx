// app/(app)/monitor/page.tsx
import { getSupabaseServer } from '@/lib/supabase/server';
import { fetchUnpaidRows } from '@/lib/monitor-server';
import { MonitorBoard } from '@/components/monitor-board';

export const dynamic = 'force-dynamic';

export default async function MonitorPage() {
  const supabase = await getSupabaseServer();
  const rows = await fetchUnpaidRows(supabase);

  return (
    <div className="space-y-6">
      <div>
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Monitor
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          Meja <span className="italic">belum bayar</span>
        </h1>
        <p className="mt-2 text-sm text-coal-soft">
          Diperbarui otomatis tiap 15 detik. Tandai lunas saat meja sudah bayar.
        </p>
      </div>

      <MonitorBoard initialRows={rows} />
    </div>
  );
}
