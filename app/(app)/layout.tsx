import { redirect } from 'next/navigation';
import { Nav } from '@/components/nav';
import { getSupabaseServer } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Nav />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 md:py-10">{children}</main>
      <footer className="mx-auto w-full max-w-5xl border-t border-clay-soft/40 px-4 py-4 text-center text-[11px] uppercase tracking-[0.16em] text-clay">
        Pecel Lele Pak Pon · Bandar Lampung
      </footer>
    </div>
  );
}
