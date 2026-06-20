import { getSupabaseServer } from '@/lib/supabase/server';
import { MenuListClient } from './menu-list-client';

export const dynamic = 'force-dynamic';

export default async function MenuPage() {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase
    .from('menus')
    .select('id, name, category, price, sort_order, is_active')
    .order('category')
    .order('sort_order')
    .order('name');

  if (error) {
    return <p className="text-red-600">Gagal memuat menu: {error.message}</p>;
  }
  return <MenuListClient initialMenus={data ?? []} />;
}
