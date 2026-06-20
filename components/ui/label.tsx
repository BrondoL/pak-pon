import * as React from 'react';

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className = '', ...rest }: LabelProps) {
  return (
    <label
      className={[
        'block text-[11px] font-semibold uppercase tracking-[0.08em] text-coal-soft',
        className,
      ].join(' ')}
      {...rest}
    />
  );
}
