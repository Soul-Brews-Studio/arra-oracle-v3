import { useId } from 'react';

export type MeterTone = 'accent' | 'accent2' | 'success' | 'warning' | 'danger';

const fillClasses: Record<MeterTone, string> = {
  accent: 'bg-accent-solid',
  accent2: 'bg-accent2-solid',
  success: 'bg-ok-text',
  warning: 'bg-warn-text',
  danger: 'bg-err-text',
};

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}

export function MeterBar({
  label,
  valueText,
  percent,
  tone = 'accent',
  description,
}: {
  label: string;
  valueText: string;
  percent: number;
  tone?: MeterTone;
  description?: string;
}) {
  const labelId = useId();
  const bounded = clampPercent(percent);
  const rounded = Math.round(bounded);
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3 text-sm text-text">
        <span id={labelId} className="text-text-muted">{label}</span>
        <span className="font-medium">{valueText}</span>
      </div>
      <div
        aria-labelledby={labelId}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={rounded}
        aria-valuetext={`${valueText} · ${rounded}%`}
        className="h-2 overflow-hidden rounded-full border border-border bg-field"
        role="meter"
      >
        <div className={`h-full rounded-full transition-all ${fillClasses[tone]}`} style={{ width: `${Math.max(3, bounded).toFixed(0)}%` }} />
      </div>
      {description ? <p className="text-xs text-text-muted">{description}</p> : null}
    </div>
  );
}
