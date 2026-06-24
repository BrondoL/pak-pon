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
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-3 sm:gap-4 sm:px-4">
        {/* Brand mark — logo always visible, wordmark text only on sm+ */}
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2.5 leading-none"
          aria-label="Pak Pon — beranda"
        >
          <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full ring-2 ring-gold/40 transition-transform duration-[var(--duration-base)] group-hover:scale-105">
            <Image
              src="/pakpon-logo.jpg"
              alt=""
              fill
              sizes="36px"
              className="object-cover"
              priority
            />
          </span>
          <span className="hidden flex-col leading-tight sm:flex">
            <span className="font-display text-lg italic font-semibold text-gold">
              Pak Pon
            </span>
            <span className="font-body text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-soft">
              Pecel Lele
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-0.5 text-xs sm:text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md px-2 py-1.5 font-medium text-ink transition-colors duration-[var(--duration-fast)] hover:bg-night-soft hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-night sm:px-3"
            >
              {l.label}
            </Link>
          ))}

          <Link
            href="/setup/printer/settings"
            aria-label="Setup & setting printer"
            title="Setup & setting printer"
            className="ml-0.5 inline-flex h-9 w-9 items-center justify-center rounded-md text-ink transition-colors duration-[var(--duration-fast)] hover:bg-night-soft hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-night sm:ml-1"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>

          <form action="/api/auth/signout" method="post" className="ml-0.5 sm:ml-1">
            <button
              type="submit"
              className="rounded-md px-2 py-1.5 font-medium text-ink-soft transition-colors duration-[var(--duration-fast)] hover:bg-night-soft hover:text-brick-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-night sm:px-3"
            >
              Keluar
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
