export default function SetupPrinterPage() {
  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-semibold text-coal">Setup Print Agent</h1>

      <section className="space-y-3">
        <p className="text-sm text-coal-soft">
          Untuk mencetak nota ke printer dapur &amp; minuman, kamu butuh aplikasi
          <strong> Print Agent</strong> yang berjalan di tab Android di warung.
          Web app ini cuma mengirim job cetak ke server &mdash; Print Agent yang
          mengambil job dan mengirim ke printer LAN.
        </p>
      </section>

      <section className="space-y-3 rounded-md border border-mustard-soft bg-mustard-faint p-4">
        <h2 className="text-lg font-medium text-coal">Status Print Agent</h2>
        <p className="text-sm text-coal-soft">
          Print Agent app belum tersedia (sedang dikembangkan). Untuk sekarang,
          job cetak yang dikirim dari web akan masuk antrian tapi tidak akan dicetak
          sampai Print Agent dijalankan.
        </p>
        <p className="text-sm text-coal-soft">
          Spesifikasi teknis Print Agent: lihat dokumen{' '}
          <code className="bg-clay-mist px-1">docs/superpowers/specs/print-agent-design.md</code>.
        </p>
      </section>

      <section className="space-y-3 pt-4 border-t border-clay-soft">
        <h2 className="text-lg font-medium text-coal">Diagnostic</h2>
        <p className="text-sm text-coal-soft">
          Lihat antrian print job &amp; status agent di halaman diagnostic.
        </p>
        <a href="/setup/printer/debug" className="text-sm underline text-coal">
          Buka halaman diagnostic
        </a>
      </section>
    </div>
  );
}
