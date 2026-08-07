// app/(app)/monitor/page.tsx
import { getSupabaseServer } from '@/lib/supabase/server';
import { fetchUnpaidRows } from '@/lib/monitor-server';
import { getPrinterSettings } from '@/lib/printer-settings-server';
import { MonitorBoard } from '@/components/monitor-board';
import type { MenuOption } from '@/components/nota-item-modal';

export const dynamic = 'force-dynamic';

type MenuRow = {
  id: string;
  name: string;
  category: MenuOption['category'];
  price: number;
  sort_order: number;
  chips: MenuOption['chips'] | null;
};

export default async function MonitorPage() {
  const supabase = await getSupabaseServer();

  // menus + printerSettings ikut dirender di server supaya modal "Tambah Item"
  // terbuka instan — tanpa fetch apa pun saat kasir menekan tombolnya.
  const [rows, { data: menusRaw }, printerSettings] = await Promise.all([
    fetchUnpaidRows(supabase),
    supabase
      .from('menus')
      .select(`
        id, name, category, price, sort_order, is_active,
        chips:menu_chips(id, label, price_delta, mutex_group, sort_order)
      `)
      .eq('is_active', true)
      .order('category')
      .order('sort_order')
      .order('name'),
    getPrinterSettings(),
  ]);

  const menus: MenuOption[] = ((menusRaw ?? []) as MenuRow[]).map((m) => ({
    id: m.id,
    name: m.name,
    category: m.category,
    price: m.price,
    chips: [...(m.chips ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  }));

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
