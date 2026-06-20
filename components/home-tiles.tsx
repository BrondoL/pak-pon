import Link from 'next/link';

const tiles = [
  { href: '/scan',         emoji: '📷', title: 'Scan Nota',   subtitle: 'Foto nota baru' },
  { href: '/transactions', emoji: '📋', title: 'History',     subtitle: 'Transaksi tersimpan' },
  { href: '/reports',      emoji: '📊', title: 'Reports',     subtitle: 'Harian & bulanan' },
  { href: '/menu',         emoji: '🍽️', title: 'Menu Master', subtitle: 'Atur menu & harga' },
];

export function HomeTiles() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4">
      {tiles.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className="rounded-2xl border border-zinc-200 bg-white p-6 text-center transition hover:border-zinc-400 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
        >
          <div className="text-3xl">{t.emoji}</div>
          <div className="mt-2 font-semibold">{t.title}</div>
          <div className="mt-1 text-xs text-zinc-500">{t.subtitle}</div>
        </Link>
      ))}
    </div>
  );
}
