import Link from 'next/link';

const links = [
  { href: '/scan',         label: 'Scan' },
  { href: '/transactions', label: 'History' },
  { href: '/reports',      label: 'Laporan' },
  { href: '/menu',         label: 'Menu' },
];

export function Nav() {
  return (
    <header className="border-b border-clay-soft/70 bg-paper-soft/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        {/* Brand mark — Fraunces display, brick underline-stamp accent */}
        <Link
          href="/"
          className="group flex items-baseline gap-1.5 font-display text-[19px] leading-none tracking-tight text-coal"
          aria-label="Pak Pon — beranda"
        >
          <span className="underline-stamp italic">Pak Pon</span>
          <span className="hidden font-body text-[11px] font-medium uppercase tracking-[0.18em] text-clay sm:inline">
            warung
          </span>
        </Link>

        <nav className="flex items-center gap-0.5 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md px-3 py-1.5 font-medium text-coal-soft transition-colors duration-[var(--duration-fast)] hover:bg-cream hover:text-coal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brick focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
            >
              {l.label}
            </Link>
          ))}

          <form action="/api/auth/signout" method="post" className="ml-1">
            <button
              type="submit"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-clay transition-colors duration-[var(--duration-fast)] hover:bg-cream hover:text-paprika focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brick focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
            >
              Keluar
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
