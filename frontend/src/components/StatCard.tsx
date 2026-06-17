import type { ReactNode } from 'react';

export function StatCard({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-muted p-4 shadow-xl shadow-black/10">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-text">{value}</p>
      <p className="mt-1 text-sm text-text-muted">{detail}</p>
    </div>
  );
}
