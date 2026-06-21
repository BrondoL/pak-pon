'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
  nasi: 'Nasi & Side',
  minuman: 'Minuman',
};

export function MenuListClient({ initialMenus }: { initialMenus: Menu[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Partial<MenuFormValues> | null>(null);
  const [pending, startTransition] = useTransition();
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Inline confirmation: hold the id of the row showing a "Yakin?" confirmation,
  // instead of using window.confirm() browser dialog.
  const [confirmingDeactivate, setConfirmingDeactivate] = useState<string | null>(null);

  const grouped = (['makanan', 'nasi', 'minuman'] as const).map((cat) => ({
    cat,
    items: initialMenus.filter((m) => m.category === cat),
  }));

  function refresh() {
    setEditing(null);
    setMutationError(null);
    setConfirmingDeactivate(null);
    startTransition(() => router.refresh());
  }

  async function performDeactivate(id: string) {
    setMutationError(null);
    try {
      const res = await fetch(`/api/menus/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete-failed');
      toast.success('Menu dinonaktifkan');
      refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'delete-failed';
      setMutationError('Gagal menonaktifkan menu. Coba lagi.');
      toast.error('Gagal menonaktifkan menu', { description: message });
      setConfirmingDeactivate(null);
    }
  }

  async function handleReactivate(id: string) {
    setMutationError(null);
    try {
      const res = await fetch(`/api/menus/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: true }),
      });
      if (!res.ok) throw new Error('reactivate-failed');
      refresh();
    } catch {
      setMutationError('Gagal mengaktifkan menu. Coba lagi.');
    }
  }

  return (
    <div className="space-y-8">
      {/* Editorial-style page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="font-body text-[11px] font-medium uppercase tracking-[0.22em] text-clay">
            Menu Master
          </p>
          <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
            Daftar <span className="italic">menu</span>
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-coal-soft">
            Sumber kebenaran harga & nama menu. Dipakai OCR untuk mencocokkan item dari nota.
          </p>
        </div>
        <Button onClick={() => setEditing({ category: 'makanan', sort_order: 0 })}>
          + Menu baru
        </Button>
      </div>

      {editing && (
        <MenuForm
          initial={editing}
          onSaved={refresh}
          onCancel={() => setEditing(null)}
        />
      )}

      {mutationError && (
        <p
          className="rounded-md border border-brick/30 bg-brick-faint px-3 py-2 text-sm text-brick-dark"
          role="alert"
        >
          {mutationError}
        </p>
      )}

      <div className="space-y-8">
        {grouped.map(({ cat, items }) => (
          <section key={cat}>
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="font-display text-xl italic text-coal">
                {CATEGORY_LABEL[cat]}
              </h2>
              <span className="text-[11px] uppercase tracking-[0.16em] text-clay">
                {items.length} item
              </span>
            </div>

            <Card variant="paper" className="overflow-hidden">
              <ul className="divide-y divide-clay-soft/60">
                {items.length === 0 && (
                  <li className="px-5 py-8 text-center text-sm text-clay">
                    Belum ada menu di kategori ini.
                  </li>
                )}

                {items.map((m) => {
                  const isConfirming = confirmingDeactivate === m.id;
                  return (
                    <li
                      key={m.id}
                      className={[
                        'flex items-center justify-between gap-4 px-5 py-3.5 transition-colors',
                        isConfirming ? 'bg-brick-faint' : '',
                        !m.is_active ? 'opacity-55' : '',
                      ].join(' ')}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="font-medium text-coal truncate">{m.name}</span>
                          {!m.is_active && (
                            <span className="rounded-sm bg-clay-mist px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-coal-soft">
                              nonaktif
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-clay">
                          <span className="font-display text-sm tracking-tight text-coal-soft">
                            {formatRp(m.price)}
                          </span>
                          <span className="text-clay-soft">·</span>
                          <span>urutan {m.sort_order}</span>
                        </div>
                      </div>

                      {/* Inline confirmation — replaces window.confirm() */}
                      {isConfirming ? (
                        <div className="flex items-center gap-2">
                          <span className="hidden text-xs italic text-coal-soft sm:inline">
                            Yakin nonaktifkan?
                          </span>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setConfirmingDeactivate(null)}
                          >
                            Batal
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => performDeactivate(m.id)}
                          >
                            Ya, nonaktifkan
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing(m)}
                          >
                            Edit
                          </Button>
                          {m.is_active ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmingDeactivate(m.id)}
                            >
                              Nonaktifkan
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleReactivate(m.id)}
                            >
                              Aktifkan
                            </Button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          </section>
        ))}
      </div>

      {pending && (
        <div className="text-center text-xs uppercase tracking-[0.16em] text-clay">
          Memuat ulang…
        </div>
      )}
    </div>
  );
}
