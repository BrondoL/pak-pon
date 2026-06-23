const APK_URL = process.env.NEXT_PUBLIC_PRINT_AGENT_APK_URL ?? '';

export default function SetupPrinterPage() {
  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-semibold text-coal">Setup Print Agent</h1>

      <section className="space-y-3">
        <p className="text-sm text-coal-soft">
          Print Agent adalah aplikasi Android yang berjalan di tab kasir. Tugasnya
          menerima job cetak dari web app dan meneruskan ke printer dapur &amp;
          minuman lewat jaringan LAN warung.
        </p>
        <p className="text-sm text-coal-soft">
          Aplikasi ini perlu jalan terus selama jam operasional warung. Tandanya
          ada notifikasi persistent <strong>&quot;Pak Pon Print Agent · Online&quot;</strong>{' '}
          di status bar HP.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-coal">1. Install aplikasi</h2>
        <ol className="list-decimal space-y-1 pl-6 text-sm text-coal">
          <li>Tap tombol Download di bawah dari Chrome di HP/tab Android warung</li>
          <li>
            Saat install, Android tampilkan warning <em>&quot;Install unknown apps&quot;</em>{' '}
            &mdash; tap Setting, enable untuk Chrome
          </li>
          <li>Buka file APK yang ter-download, tap Install</li>
        </ol>
        {APK_URL ? (
          <a
            href={APK_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-block rounded-md bg-primary px-4 py-2 text-primary-foreground"
          >
            Download Print Agent
          </a>
        ) : (
          <p className="rounded-md border border-clay-soft bg-clay-mist p-3 text-sm text-coal-soft">
            Link install belum dikonfigurasi. Hubungi admin untuk mendapat file APK.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-coal">2. Login &amp; konfigurasi</h2>
        <ol className="list-decimal space-y-1 pl-6 text-sm text-coal">
          <li>
            Buka aplikasi <strong>Pak Pon Agent</strong> yang baru di-install
          </li>
          <li>
            Login pakai email &amp; password warung &mdash; sama dengan akun yang
            kamu pakai di web ini
          </li>
          <li>
            Di tab <strong>Settings</strong>: isi IP printer dapur &amp; minuman
            (cek di printer atau di setting router), port <strong>9100</strong>
          </li>
          <li>
            Tap <strong>Test koneksi</strong> per printer &mdash; pastikan dua-duanya
            balas berhasil sebelum lanjut
          </li>
          <li>
            (Opsional tapi disarankan) Aktifkan <strong>Auto-start on boot</strong>{' '}
            biar agent jalan otomatis tiap HP dinyalakan ulang
          </li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-coal">3. Cek status</h2>
        <p className="text-sm text-coal-soft">
          Setelah agent jalan, banner peringatan di halaman utama akan hilang sendiri.
          Coba scan satu nota tes &mdash; nota dapur &amp; minuman harus keluar di
          printer masing-masing.
        </p>
        <p className="text-sm text-coal-soft">Kalau banner masih muncul atau ada print yang gagal:</p>
        <ul className="list-disc space-y-1 pl-6 text-sm text-coal-soft">
          <li>Pastikan agent app masih jalan (cek notifikasi di status bar HP)</li>
          <li>Pastikan HP terhubung WiFi warung yang sama dengan printer</li>
          <li>Cek halaman diagnostic untuk status agent &amp; antrian print job</li>
        </ul>
        <a
          href="/setup/printer/debug"
          className="inline-block text-sm underline text-coal"
        >
          Buka halaman diagnostic →
        </a>
      </section>
    </div>
  );
}
