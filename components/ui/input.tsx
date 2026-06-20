import * as React from 'react';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', ...rest }, ref) => (
    <input
      ref={ref}
      className={[
        'w-full rounded-md bg-paper-soft px-3 py-2.5 text-sm text-coal',
        'border border-clay-soft',
        'placeholder:text-clay',
        'transition-colors duration-[var(--duration-fast)]',
        'hover:border-clay',
        'focus:outline-none focus:border-brick focus:ring-2 focus:ring-brick/20',
        'disabled:opacity-50 disabled:bg-cream',
        className,
      ].join(' ')}
      {...rest}
    />
  )
);
Input.displayName = 'Input';
