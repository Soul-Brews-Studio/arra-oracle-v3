import { useId, type ReactNode } from 'react';

export type StatTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const toneClasses: Record<StatTone, string> = {
  neutral: 'border-border',
  accent: 'border-accent-border',
  success: 'border-ok-border',
  warning: 'border-warn-border',
  danger: 'border-err-border',
};

const valueClasses: Record<StatTone, string> = {
  neutral: 'text-text',
  accent: 'text-accent',
  success: 'text-ok-text',
  warning: 'text-warn-text',
  danger: 'text-err-text',
};

export function StatCard({
  label,
  value,
  detail,
  tone = 'neutral',
  trend,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  tone?: StatTone;
  trend?: string;
}) {
  const labelId = useId();
  return (
    <article
      aria-labelledby={labelId}
      className={`glass glass-hover min-w-0 rounded-2xl border p-4 transition-[background-color,border-color,box-shadow] duration-200 ease-out ${toneClasses[tone]}`}
    >
      <p id={labelId} className="text-xs font-medium uppercase tracking-[0.2em] text-text-muted">{label}</p>
      <div className="mt-2 flex flex-wrap items-baseline gap-2">
        <p className={`text-3xl font-semibold ${valueClasses[tone]}`} aria-live="polite">{value}</p>
        {trend ? <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-text-muted">{trend}</span> : null}
      </div>
      <p className="mt-1 break-words text-sm text-text-muted">{detail}</p>
    </article>
  );
}
