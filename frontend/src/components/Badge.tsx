import type { ReactNode } from 'react';

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-[color:var(--color-accent,#0f766e)] px-2.5 py-1 text-xs font-medium text-[color:var(--color-accent,#0f766e)] dark:border-[color:var(--color-accent,#5eead4)] dark:text-[color:var(--color-accent,#5eead4)]" data-contrast-badge>
      {children}
    </span>
  );
}
