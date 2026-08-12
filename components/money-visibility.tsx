'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { formatRp } from '@/lib/currency';
import { cn } from '@/lib/utils';

const MASKED = 'Rp •••••';

const MoneyVisibilityContext = createContext<{ hidden: boolean; toggle: () => void }>({
  hidden: true,
  toggle: () => {},
});

export function MoneyVisibilityProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(true);
  return (
    <MoneyVisibilityContext.Provider value={{ hidden, toggle: () => setHidden((h) => !h) }}>
      {children}
    </MoneyVisibilityContext.Provider>
  );
}

export function useMoneyHidden() {
  return useContext(MoneyVisibilityContext);
}

export function MoneyValue({ amount, className }: { amount: number | null; className?: string }) {
  const { hidden } = useMoneyHidden();
  return <span className={className}>{hidden ? MASKED : amount == null ? '—' : formatRp(amount)}</span>;
}

export function MoneyToggle({ className }: { className?: string }) {
  const { hidden, toggle } = useMoneyHidden();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={hidden ? 'Tampilkan jumlah' : 'Sembunyikan jumlah'}
      title={hidden ? 'Tampilkan jumlah' : 'Sembunyikan jumlah'}
      className={cn('shrink-0 text-clay transition-colors hover:text-coal', className)}
    >
      {hidden ? <EyeIcon size={16} aria-hidden /> : <EyeOffIcon size={16} aria-hidden />}
    </button>
  );
}
