import type { ReactNode } from 'react';

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-ok-border bg-ok-bg px-2.5 py-1 text-xs font-medium text-ok-text dark:border-ok-border dark:text-ok-text" data-contrast-badge data-contrast-target="badge">
      {children}
    </span>
  );
}
