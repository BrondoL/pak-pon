'use client';

import { useActionState } from 'react';
import { loginAction, type LoginState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Brand mark — sets warm warung tone */}
        <div className="mb-8 text-center">
          <p className="font-body text-[11px] font-medium uppercase tracking-[0.22em] text-clay">
            Sistem Internal
          </p>
          <h1 className="mt-3 font-display text-4xl italic leading-none tracking-tight text-coal">
            Pecel Lele
            <span className="block not-italic">
              <span className="underline-stamp font-semibold">Pak Pon</span>
            </span>
          </h1>
          <p className="mt-4 font-display text-sm italic text-coal-soft">
            Selamat datang. Silakan masuk.
          </p>
        </div>

        <Card variant="paper" className="p-6 sm:p-8">
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
                className="mt-2"
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
                className="mt-2"
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
        </Card>

        <p className="mt-6 text-center text-[11px] uppercase tracking-[0.16em] text-clay">
          Bandar Lampung · Sejak 2009
        </p>
      </div>
    </main>
  );
}
