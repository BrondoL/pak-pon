import { PhotoUploader } from '@/components/photo-uploader';

export default function ScanPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Scan Nota
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          Foto <span className="italic">nota</span> baru
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-coal-soft">
          OCR akan otomatis baca item dan total. Anda bisa edit hasilnya sebelum disimpan.
        </p>
      </div>

      <PhotoUploader />
    </div>
  );
}
