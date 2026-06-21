import { redirect } from 'next/navigation';
import { Nav } from '@/components/nav';
import { Toaster } from '@/components/ui/sonner';
import { getSupabaseServer } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Nav />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 md:py-10">{children}</main>
      <footer className="surface-night mt-12">
        <div className="mx-auto max-w-5xl px-4 py-5 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-soft">
          <span className="text-gold">★</span> Pecel Lele Pak Pon · Bandar Lampung <span className="text-gold">★</span>
        </div>
      </footer>
      <Toaster richColors position="top-center" />
    </div>
  );
}
