import Link from 'next/link';

const tiles = [
  {
    href: '/scan',
    title: 'Scan Nota',
    subtitle: 'Foto nota → otomatis tercatat',
    accent: 'brick',
    glyph: (
      <svg viewBox="0 0 32 32" fill="none" className="h-7 w-7" aria-hidden>
        <rect x="4" y="9" width="24" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
        <rect x="11" y="5" width="10" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="16" cy="18" r="4.5" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="16" cy="18" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    href: '/pos',
    title: 'Buat Pesanan',
    subtitle: 'Input langsung tanpa nota',
    accent: 'gold',
    glyph: (
      <svg viewBox="0 0 32 32" fill="none" className="h-7 w-7" aria-hidden>
        <path d="M7 7h18l-2 14a2 2 0 01-2 2H11a2 2 0 01-2-2L7 7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M12 11v-2a4 4 0 018 0v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: '/monitor',
    title: 'Monitor',
    subtitle: 'Meja belum bayar',
    accent: 'mustard',
    glyph: (
      <svg viewBox="0 0 32 32" fill="none" className="h-7 w-7" aria-hidden>
        <rect x="4" y="6" width="24" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 26h8M16 22v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="16" cy="14" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    ),
  },
  {
    href: '/transactions',
    title: 'History',
    subtitle: 'Transaksi tersimpan',
    accent: 'coal',
    glyph: (
      <svg viewBox="0 0 32 32" fill="none" className="h-7 w-7" aria-hidden>
        <path d="M7 5h14l3 3v19a1 1 0 01-1.5 0L21 25l-2.5 2-2.5-2-2.5 2L11 25l-2.5 2L7 27V5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M11 11h10M11 15h10M11 19h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: '/reports',
    title: 'Laporan',
    subtitle: 'Harian & bulanan',
    accent: 'mustard',
    glyph: (
      <svg viewBox="0 0 32 32" fill="none" className="h-7 w-7" aria-hidden>
        <path d="M5 27V11M12 27V17M19 27V5M26 27V14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: '/menu',
    title: 'Menu Master',
    subtitle: 'Atur menu & harga',
    accent: 'leaf',
    glyph: (
      <svg viewBox="0 0 32 32" fill="none" className="h-7 w-7" aria-hidden>
        <path d="M8 5h16a2 2 0 012 2v19l-5-3-5 3-5-3-5 3V7a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M12 11h8M12 15h8M12 19h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
];

const accentClasses: Record<string, { bg: string; text: string }> = {
  brick:   { bg: 'bg-brick-faint',   text: 'text-brick' },
  coal:    { bg: 'bg-clay-mist',     text: 'text-coal' },
  mustard: { bg: 'bg-mustard-faint', text: 'text-mustard' },
  leaf:    { bg: 'bg-leaf/10',       text: 'text-leaf' },
  gold:    { bg: 'bg-gold-faint',    text: 'text-gold' },
};

export function HomeTiles() {
  return (
    <div className="reveal-children grid grid-cols-2 gap-3 md:gap-4">
      {tiles.map((t) => {
        const a = accentClasses[t.accent];
        return (
          <Link
            key={t.href}
            href={t.href}
            className={[
              'group relative rounded-2xl border border-clay-soft bg-paper-soft p-5 md:p-6',
              'shadow-[var(--shadow-paper)]',
              'transition-[transform,box-shadow,border-color] duration-[var(--duration-base)] ease-[var(--ease-warm)]',
              'hover:-translate-y-0.5 hover:border-coal-soft/40 hover:shadow-[var(--shadow-stamp)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brick focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
            ].join(' ')}
          >
            <div className={[
              'mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl',
              a.bg, a.text,
              'transition-transform duration-[var(--duration-base)] ease-[var(--ease-warm)] group-hover:scale-105',
            ].join(' ')}>
              {t.glyph}
            </div>
            <h3 className="font-display text-lg italic leading-tight text-coal">
              {t.title}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-clay">
              {t.subtitle}
            </p>
            <span
              aria-hidden
              className="absolute right-5 top-5 text-clay-soft transition-all duration-[var(--duration-fast)] group-hover:translate-x-0.5 group-hover:text-coal-soft"
            >
              →
            </span>
          </Link>
        );
      })}
    </div>
  );
}
