'use client';

import { useActionState } from 'react';
import Image from 'next/image';
import { loginAction, type LoginState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <main className="surface-night flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Logo brand mark */}
        <div className="mb-6 flex justify-center">
          <div className="relative h-32 w-32 overflow-hidden rounded-full ring-4 ring-gold/30 shadow-2xl">
            <Image
              src="/pakpon-logo.jpg"
              alt="Pecel Lele Pak Pon"
              fill
              sizes="128px"
              className="object-cover"
              priority
            />
          </div>
        </div>

        <div className="mb-8 text-center">
          <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-mist">
            Sistem Internal
          </p>
          <h1 className="mt-2 font-display text-3xl italic font-semibold text-gold leading-tight">
            Pak Pon
          </h1>
          <p className="mt-1 font-body text-xs uppercase tracking-[0.32em] text-ink font-semibold">
            Pecel Lele
          </p>
          <p className="mt-5 font-display text-base italic text-ink">
            Selamat datang. Silakan masuk.
          </p>
        </div>

        {/* Form card — cream surface on navy background for contrast */}
        <div className="rounded-2xl bg-paper-soft p-6 shadow-2xl sm:p-7">
          <form action={formAction} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="username"
                placeholder="kasir@pakpon.id"
                className="mt-2 text-black"
              />
            </div>

            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                minLength={6}
                placeholder="••••••••"
                className="mt-2 text-black"
              />
            </div>

            {state.error && (
              <p
                className="rounded-md bg-brick-faint px-3 py-2 text-sm text-brick-dark"
                role="alert"
              >
                {state.error}
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={pending}
              className="w-full"
            >
              {pending ? 'Membuka pintu…' : 'Masuk'}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-soft">
          <span className="text-gold">★</span> Bandar Lampung <span className="text-gold">★</span>
        </p>
      </div>
    </main>
  );
}
