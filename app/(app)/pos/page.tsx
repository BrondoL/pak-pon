import { redirect } from 'next/navigation';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getPrinterSettings } from '@/lib/printer-settings-server';
import { PosClient } from '@/components/pos/pos-client';
import type { MenuOption } from '@/components/nota-item-modal';

export const dynamic = 'force-dynamic';

export default async function PosPage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: menusRaw }, printerSettings] = await Promise.all([
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

  type MenuRow = {
    id: string;
    name: string;
    category: MenuOption['category'];
    price: number;
    sort_order: number;
    chips: MenuOption['chips'] | null;
  };

  const menus: MenuOption[] = ((menusRaw ?? []) as MenuRow[]).map((m) => ({
    id: m.id,
    name: m.name,
    category: m.category,
    price: m.price,
    chips: [...(m.chips ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="font-display text-3xl leading-tight text-coal mb-4">
        Buat <span className="italic">pesanan</span>
      </h1>
      <PosClient menus={menus} printerSettings={printerSettings} />
    </div>
  );
}
