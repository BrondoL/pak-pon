'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatRp } from '@/lib/currency';
import { MenuForm, type MenuFormValues } from '@/components/menu-form';

type Menu = {
  id: string;
  name: string;
  category: 'makanan' | 'nasi' | 'minuman';
  price: number;
  sort_order: number;
  is_active: boolean;
};

const CATEGORY_LABEL: Record<Menu['category'], string> = {
  makanan: 'Makanan',
  nasi: 'Nasi & side',
  minuman: 'Minuman',
};

export function MenuListClient({ initialMenus }: { initialMenus: Menu[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Partial<MenuFormValues> | null>(null);
  const [pending, startTransition] = useTransition();

  const grouped = (['makanan', 'nasi', 'minuman'] as const).map((cat) => ({
    cat,
    items: initialMenus.filter((m) => m.category === cat),
  }));

  function refresh() {
    setEditing(null);
    startTransition(() => router.refresh());
  }

  async function handleDeactivate(id: string) {
    if (!confirm('Nonaktifkan menu ini? (Transaksi historis tetap aman)')) return;
    await fetch(`/api/menus/${id}`, { method: 'DELETE' });
    refresh();
  }

  async function handleReactivate(id: string) {
    await fetch(`/api/menus/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: true }),
    });
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Menu Master</h1>
        <Button onClick={() => setEditing({ category: 'makanan', sort_order: 0 })}>+ Menu Baru</Button>
      </div>

      {editing && (
        <MenuForm
          initial={editing}
          onSaved={refresh}
          onCancel={() => setEditing(null)}
        />
      )}

      {grouped.map(({ cat, items }) => (
        <section key={cat}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            {CATEGORY_LABEL[cat]}
          </h2>
          <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {items.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-zinc-500">Belum ada menu.</li>
            )}
            {items.map((m) => (
              <li key={m.id} className={`flex items-center justify-between px-4 py-3 ${m.is_active ? '' : 'opacity-50'}`}>
                <div>
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-zinc-500">{formatRp(m.price)} • urutan {m.sort_order}</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setEditing(m)}>Edit</Button>
                  {m.is_active ? (
                    <Button variant="ghost" onClick={() => handleDeactivate(m.id)}>Nonaktifkan</Button>
                  ) : (
                    <Button variant="ghost" onClick={() => handleReactivate(m.id)}>Aktifkan</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {pending && <div className="text-center text-sm text-zinc-500">Memuat ulang…</div>}
    </div>
  );
}
