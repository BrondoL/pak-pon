// app/(app)/monitor/page.tsx
import { getSupabaseServer } from '@/lib/supabase/server';
import { fetchUnpaidRows } from '@/lib/monitor-server';
import { getPrinterSettings } from '@/lib/printer-settings-server';
import { fetchActiveMenusWithChips } from '@/lib/menus-server';
import { MonitorBoard } from '@/components/monitor-board';

export const dynamic = 'force-dynamic';

export default async function MonitorPage() {
  const supabase = await getSupabaseServer();

  // menus + printerSettings ikut dirender di server supaya modal "Tambah Item"
  // terbuka instan — tanpa fetch apa pun saat kasir menekan tombolnya.
  const [rows, menus, printerSettings] = await Promise.all([
    fetchUnpaidRows(supabase),
    fetchActiveMenusWithChips(supabase),
    getPrinterSettings(),
  ]);

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

      <MonitorBoard initialRows={rows} menus={menus} printerSettings={printerSettings} />
    </div>
  );
}
