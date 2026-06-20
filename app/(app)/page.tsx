import { HomeTiles } from '@/components/home-tiles';

export default function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Selamat datang</h1>
        <p className="mt-1 text-sm text-zinc-500">Pilih menu di bawah untuk mulai.</p>
      </div>
      <HomeTiles />
    </div>
  );
}
