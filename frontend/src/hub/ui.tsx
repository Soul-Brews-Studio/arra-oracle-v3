/** Small shared pieces of the hub UI. */

import type { ReactNode } from 'react';
import { Badge as StudioBadge, type BadgeTone } from '../components/Badge';
import { Glass } from '../components/Glass';
import { StatCard } from '../components/StatCard';

/** Hub pages are a Studio route (#3110): cards, stats and badges are Studio's own components. */
export function Card({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <Glass className="min-w-0 p-5 sm:p-6">
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-text">{title}</h2>
          {right}
        </div>
        {children}
      </section>
    </Glass>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return <StatCard label={label} value={value} detail={hint ?? ''} tone="accent" />;
}

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <StudioBadge tone={tone}>{children}</StudioBadge>;
}

export function OwnerOnly({ what }: { what: string }) {
  return (
    <div data-testid="owner-only" className="status-warn rounded-3xl border p-5">
      <div className="font-semibold">Owner only</div>
      <p className="mt-1 text-sm">
        {what} is served by <code className="font-mono">/api/arra</code>, which answers only on the hub machine itself.
        Open <code className="font-mono">http://127.0.0.1:&lt;port&gt;/hub</code> there. Other machines see the public hub card on Status.
      </p>
    </div>
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? <p role="alert" className="mt-3 text-sm text-err-text">{error}</p> : null;
}

export const button = 'focus-ring rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40';
export const primary = `${button} bg-accent-solid text-on-accent hover:bg-accent-hover`;
export const danger = `${button} border border-err-border text-err-text hover:bg-err-bg`;
export const ghost = `${button} border border-accent-border text-accent hover:bg-accent-soft`;
export const input = 'focus-ring rounded-xl border border-border bg-field px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none';
