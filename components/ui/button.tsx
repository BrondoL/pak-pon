import * as React from 'react';

/**
 * Button — paper-stamp aesthetic.
 * Variants reference design tokens dari globals.css.
 */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'night';
type Size = 'sm' | 'md' | 'lg';

const variantStyles: Record<Variant, string> = {
  // Primary = brand gold. Bold attention-grabbing action.
  primary:
    'bg-gold text-night-deep font-semibold hover:bg-gold-soft active:bg-gold-dark shadow-[var(--shadow-stamp)] active:shadow-[var(--shadow-paper)] active:translate-y-px',
  secondary:
    'bg-paper-soft text-coal border border-clay-soft hover:bg-cream active:bg-clay-mist',
  ghost:
    'bg-transparent text-coal-soft hover:bg-cream hover:text-coal',
  danger:
    'bg-brick text-paper hover:bg-brick-soft active:bg-brick-dark active:translate-y-px',
  // Night = navy chrome action, used on dark backgrounds
  night:
    'bg-night text-ink hover:bg-night-soft active:bg-night-deep',
};

const sizeStyles: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', ...rest }, ref) => (
    <button
      ref={ref}
      className={[
        'inline-flex items-center justify-center rounded-md font-medium',
        'transition-[transform,background-color,box-shadow] duration-[var(--duration-fast)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brick focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
        'disabled:opacity-50 disabled:pointer-events-none',
        variantStyles[variant],
        sizeStyles[size],
        className,
      ].join(' ')}
      {...rest}
    />
  )
);
Button.displayName = 'Button';
