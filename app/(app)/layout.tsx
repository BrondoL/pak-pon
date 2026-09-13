import { redirect } from 'next/navigation';
import { Nav } from '@/components/nav';
import { Toaster } from '@/components/ui/sonner';
import { getCurrentActor } from '@/lib/auth/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // null = belum login, belum punya profil, atau dinonaktifkan. Semuanya diperlakukan
  // sama: keluar. Akun yang pembuatannya putus di tengah bisa login tapi tidak bisa
  // apa-apa — gagal ke arah aman.
  //
  // ⚠️ Tujuannya `/no-access`, JANGAN `/login`: `proxy.ts` memantulkan setiap request
  // `/login` yang masih bawa sesi balik ke `/`, dan `/` mendarat di sini lagi —
  // loop redirect sampai browser menyerah. `/no-access` public tapi bukan `/login`,
  // jadi request dari akun yang masih login lolos apa adanya.
  const actor = await getCurrentActor();
  if (!actor) redirect('/no-access');

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Nav actor={actor} />
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
