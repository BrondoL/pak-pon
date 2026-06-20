import Image from 'next/image';
import Link from 'next/link';

const links = [
  { href: '/scan',         label: 'Scan' },
  { href: '/transactions', label: 'History' },
  { href: '/reports',      label: 'Laporan' },
  { href: '/menu',         label: 'Menu' },
];

export function Nav() {
  return (
    <header className="surface-night border-b-2 border-gold/30">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        {/* Brand mark — logo + Pak Pon wordmark in gold */}
        <Link
          href="/"
          className="group flex items-center gap-2.5 leading-none"
          aria-label="Pak Pon — beranda"
        >
          <span className="relative h-9 w-9 overflow-hidden rounded-full ring-2 ring-gold/40 transition-transform duration-[var(--duration-base)] group-hover:scale-105">
            <Image
              src="/pakpon-logo.jpg"
              alt=""
              fill
              sizes="36px"
              className="object-cover"
              priority
            />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-display text-lg italic font-semibold text-gold">
              Pak Pon
            </span>
            <span className="font-body text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-soft">
              Pecel Lele
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-0.5 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md px-3 py-1.5 font-medium text-ink transition-colors duration-[var(--duration-fast)] hover:bg-night-soft hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-night"
            >
              {l.label}
            </Link>
          ))}

          <form action="/api/auth/signout" method="post" className="ml-1">
            <button
              type="submit"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors duration-[var(--duration-fast)] hover:bg-night-soft hover:text-brick-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-night"
            >
              Keluar
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
