/** Small shared pieces of the hub UI. */

import type { ReactNode } from 'react';

export function Card({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/70 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-4 py-3">
      <div className="text-xs uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-1 font-mono text-2xl text-gray-100">{value}</div>
      {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
    </div>
  );
}

export function Badge({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}>{children}</span>;
}

export function OwnerOnly({ what }: { what: string }) {
  return (
    <div data-testid="owner-only" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 text-amber-200">
      <div className="font-semibold">Owner only</div>
      <p className="mt-1 text-sm text-amber-200/80">
        {what} is served by <code className="font-mono">/api/arra</code>, which answers only on the hub machine itself.
        Open <code className="font-mono">http://127.0.0.1:&lt;port&gt;/hub</code> there. Other machines see the public hub card on Status.
      </p>
    </div>
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p> : null;
}

export const button = 'rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40';
export const primary = `${button} bg-sky-600 text-white hover:bg-sky-500`;
export const danger = `${button} bg-rose-600/90 text-white hover:bg-rose-500`;
export const ghost = `${button} border border-gray-700 text-gray-300 hover:bg-gray-800`;
export const input = 'rounded-md border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm text-gray-100 placeholder:text-gray-600 focus:border-sky-500 focus:outline-none';
