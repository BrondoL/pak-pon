import Link from 'next/link';

export function Nav() {
  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-base font-semibold tracking-tight">
          🍗 Pak Pon
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/scan" className="rounded px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">Scan</Link>
          <Link href="/transactions" className="rounded px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">History</Link>
          <Link href="/reports" className="rounded px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">Reports</Link>
          <Link href="/menu" className="rounded px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">Menu</Link>
          <form action="/api/auth/signout" method="post" className="ml-2">
            <button
              type="submit"
              className="rounded px-3 py-1.5 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Keluar
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
