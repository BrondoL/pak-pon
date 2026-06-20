import * as React from 'react';

type Variant = 'paper' | 'receipt' | 'inset';

const variantStyles: Record<Variant, string> = {
  paper:
    'bg-paper-soft border border-clay-soft shadow-[var(--shadow-paper)]',
  receipt:
    'bg-paper-soft border-receipt',                       // dashed border, receipt feel
  inset:
    'bg-cream border border-clay-soft/60',                // subtle inset for nested cards
};

export type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: Variant;
};

export function Card({ variant = 'paper', className = '', ...rest }: CardProps) {
  return (
    <div
      className={[
        'rounded-2xl',
        variantStyles[variant],
        className,
      ].join(' ')}
      {...rest}
    />
  );
}
