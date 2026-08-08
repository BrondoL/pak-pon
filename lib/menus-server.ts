// lib/menus-server.ts
import type { getSupabaseServer } from '@/lib/supabase/server';
import type { MenuOption } from '@/components/nota-item-modal';

type SupabaseLike = Awaited<ReturnType<typeof getSupabaseServer>>;

type MenuRow = {
  id: string;
  name: string;
  category: MenuOption['category'];
  price: number;
  sort_order: number;
  chips: MenuOption['chips'] | null;
};

/**
 * Ambil semua menu aktif beserta chip-nya, siap pakai buat menu picker.
 * Dipakai bareng oleh `/pos` dan `/monitor` (modal "Tambah Item") — satu
 * sumber query biar ordering & field chip ga drift antar route.
 */
export async function fetchActiveMenusWithChips(supabase: SupabaseLike): Promise<MenuOption[]> {
  const { data: menusRaw } = await supabase
    .from('menus')
    .select(`
      id, name, category, price, sort_order, is_active,
      chips:menu_chips(id, label, price_delta, mutex_group, sort_order)
    `)
    .eq('is_active', true)
    .order('category')
    .order('sort_order')
    .order('name');

  return ((menusRaw ?? []) as MenuRow[]).map((m) => ({
    id: m.id,
    name: m.name,
    category: m.category,
    price: m.price,
    chips: [...(m.chips ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  }));
}
