'use client';

import Link from 'next/link';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type NavLink = { href: string; label: string };

export function MobileNav({ links }: { links: NavLink[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Menu"
        title="Menu"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink transition-colors duration-[var(--duration-fast)] hover:bg-night-soft hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-night"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6"
          aria-hidden
        >
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {links.map((l) => (
          <DropdownMenuItem key={l.href} render={<Link href={l.href} />}>
            {l.label}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Setup</DropdownMenuLabel>
        <DropdownMenuItem render={<Link href="/setup/printer/settings" />}>
          Setting Printer
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/setup/ai-usage" />}>
          AI Usage
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <form action="/api/auth/signout" method="post">
          <DropdownMenuItem
            render={<button type="submit" className="w-full" />}
            className="text-brick-soft"
          >
            Keluar
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
