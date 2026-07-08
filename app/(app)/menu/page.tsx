import { getSupabaseServer } from '@/lib/supabase/server';
import { MenuListClient } from './menu-list-client';

export const dynamic = 'force-dynamic';

export default async function MenuPage() {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase
    .from('menus')
    .select(`
      id, name, category, price, sort_order, is_active,
      chips:menu_chips(id, label, price_delta, mutex_group, sort_order)
    `)
    .order('category')
    .order('sort_order')
    .order('name');

  if (error) {
    return (
      <p
        className="rounded-md border border-brick/30 bg-brick-faint px-3 py-2 text-sm text-brick-dark"
        role="alert"
      >
        Gagal memuat menu. Coba refresh halaman.
      </p>
    );
  }
  // Nested select doesn't guarantee order for chips — sort per-menu by sort_order.
  const menus = (data ?? []).map((m) => ({
    ...m,
    chips: [...(m.chips ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  }));
  return <MenuListClient initialMenus={menus} />;
}
