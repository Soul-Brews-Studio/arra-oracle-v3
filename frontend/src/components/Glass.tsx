import type { ComponentPropsWithoutRef } from 'react';

type GlassProps = ComponentPropsWithoutRef<'div'>;

export function Glass({ className = '', children, ...props }: GlassProps) {
  const classes = `glass rounded-2xl ${className}`.trim();
  return <div className={classes} {...props}>{children}</div>;
}
