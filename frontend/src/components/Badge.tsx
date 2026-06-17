import type { ReactNode } from 'react';

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-teal-300/20 bg-teal-300/10 px-2.5 py-1 text-xs font-medium text-teal-200" data-contrast-badge>
      {children}
    </span>
  );
}
