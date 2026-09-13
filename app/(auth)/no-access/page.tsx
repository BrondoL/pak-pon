import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * Halaman buntu untuk akun yang punya sesi login tapi tidak punya profil aktif:
 * `is_active=false`, akun yatim (auth user jadi tapi baris `profiles` gagal ditulis),
 * atau baris profilnya dihapus.
 *
 * ⚠️ WAJIB di luar route group `(app)`. Halaman di `(app)` melewati layout yang
 * justru me-redirect ke sini — kalau halaman ini ikut di sana, jadi loop.
 *
 * ⚠️ Juga TIDAK boleh mengarahkan ke `/login`: `proxy.ts` memantulkan setiap
 * request `/login` yang masih bawa sesi balik ke `/`, dan `/` memantulkannya ke
 * sini lagi — itulah loop yang membuat halaman ini ada. Satu-satunya jalan keluar
 * adalah tombol Keluar di bawah, yang menghapus cookie sesi lebih dulu lewat
 * `POST /api/auth/signout` (jalur itu public di `proxy.ts`) baru mendarat di `/login`.
 */
export default function NoAccessPage() {
  return (
    <main className="surface-night flex flex-1 items-center justify-center px-4 py-12">
      <div className="mx-auto w-full max-w-lg">
        <Card variant="paper" className="px-6 py-8 text-center">
          <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
            Akses belum aktif
          </p>
          <h1 className="mt-3 font-display text-2xl italic leading-snug text-coal">
            Akun Anda belum bisa dipakai.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-coal-soft">
            Akun Anda berhasil masuk, tapi belum diberi akses — atau sudah
            dinonaktifkan oleh pemilik warung. Hubungi pemilik warung supaya
            akun Anda diaktifkan dan diberi role.
          </p>
          <form action="/api/auth/signout" method="post" className="mt-6">
            <Button type="submit" variant="secondary">
              Keluar
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
