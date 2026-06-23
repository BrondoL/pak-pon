import { PhotoUploader } from '@/components/photo-uploader';

const SCAN_TIPS: { icon: string; text: string }[] = [
  { icon: '📐', text: 'Foto dari atas tegak lurus — jangan miring/sudut.' },
  { icon: '💡', text: 'Pencahayaan terang & merata, hindari bayangan tangan.' },
  { icon: '📄', text: 'Pastikan nota rata, jangan terlipat atau kusut.' },
  { icon: '✏️', text: 'Tulisan qty harus jelas (tekan pulpen, jangan terlalu tipis).' },
  { icon: '🖼️', text: 'Bingkai seluruh nota di frame, jangan terpotong.' },
  { icon: '✨', text: 'Hindari pantulan / silau dari plastik laminating.' },
];

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

      <details className="rounded-md border border-clay-soft bg-paper-soft px-4 py-3 text-sm text-coal-soft">
        <summary className="cursor-pointer font-medium text-coal">
          💡 Tips biar hasil scan lebih akurat
        </summary>
        <ul className="mt-3 space-y-2">
          {SCAN_TIPS.map((tip) => (
            <li key={tip.text} className="flex gap-2 leading-relaxed">
              <span className="shrink-0">{tip.icon}</span>
              <span>{tip.text}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-clay">
          AI bisa salah baca terutama di tulisan tipis atau pasangan menu mirip (Ayam goreng/bakar). Selalu cek hasilnya di halaman review sebelum simpan. Kalau hasil banyak yang salah, klik <strong>&quot;Scan ulang dengan Pro&quot;</strong> di halaman review (model lebih teliti, hanya boleh 1x per nota).
        </p>
      </details>
    </div>
  );
}
