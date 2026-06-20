'use client';

import { useActionState } from 'react';
import { loginAction, type LoginState } from './actions';

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form
        action={formAction}
        className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h1 className="text-xl font-semibold tracking-tight">Pecel Lele Pak Pon</h1>
        <p className="mt-1 text-sm text-zinc-500">Masuk untuk lanjut.</p>

        <label className="mt-6 block text-sm font-medium">Email</label>
        <input
          name="email"
          type="email"
          required
          autoComplete="username"
          className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
        />

        <label className="mt-4 block text-sm font-medium">Password</label>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          minLength={6}
          className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
        />

        {state.error && (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-6 w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {pending ? 'Masuk…' : 'Masuk'}
        </button>
      </form>
    </main>
  );
}
