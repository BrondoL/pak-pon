import { HomeTiles } from '@/components/home-tiles';

export default function HomePage() {
  return (
    <div className="space-y-8 md:space-y-10">
      {/* Editorial-style page header */}
      <div className="max-w-2xl">
        <p className="font-body text-[11px] font-medium uppercase tracking-[0.22em] text-clay">
          Beranda
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          Selamat datang, <span className="italic">Pak.</span>
        </h1>
        <p className="mt-3 font-display text-base italic leading-relaxed text-coal-soft md:text-lg">
          Pilih kegiatan di bawah untuk mulai. Foto nota, lihat history,
          buka laporan, atau atur menu master.
        </p>
      </div>

      <HomeTiles />
    </div>
  );
}
