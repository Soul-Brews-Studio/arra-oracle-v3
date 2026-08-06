import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'border-border bg-surface-muted text-text-muted',
  accent: 'border-accent-border bg-accent-soft text-accent',
  success: 'border-ok-border bg-ok-bg text-ok-text',
  warning: 'border-warn-border bg-warn-bg text-warn-text',
  danger: 'border-err-border bg-err-bg text-err-text',
};

export function badgeToneForStatus(status?: string): BadgeTone {
  const value = status?.toLowerCase() ?? '';
  if (['ok', 'up', 'healthy', 'connected', 'enabled', 'green', 'success'].includes(value)) return 'success';
  if (['degraded', 'draining', 'inactive', 'disabled', 'warn', 'warning', 'yellow'].includes(value)) return 'warning';
  if (['error', 'err', 'down', 'unhealthy', 'failed', 'red', 'disconnected'].includes(value)) return 'danger';
  return value ? 'accent' : 'neutral';
}

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
  className = '',
  ariaLabel,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <span
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${toneClasses[tone]} ${className}`.trim()}
      data-contrast-badge
      data-contrast-target={`badge-${tone}`}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
