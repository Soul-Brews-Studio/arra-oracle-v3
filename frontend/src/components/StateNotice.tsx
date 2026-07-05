import type { ReactNode } from 'react';

type Tone = 'info' | 'success' | 'warning' | 'error';

const toneClass: Record<Tone, string> = {
  info: 'border-accent-border bg-accent-soft text-accent',
  success: 'border-ok-border bg-ok-bg text-ok-text',
  warning: 'border-warn-border bg-warn-bg text-warn-text',
  error: 'border-err-border bg-err-bg text-err-text',
};

const roles: Record<Tone, 'status' | 'alert'> = {
  info: 'status',
  success: 'status',
  warning: 'status',
  error: 'alert',
};

export function StateNotice({
  tone = 'info',
  title,
  detail,
  action,
}: {
  tone?: Tone;
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`rounded-xl border p-4 text-sm ${toneClass[tone]}`} role={roles[tone]}>
      <p className="font-semibold">{title}</p>
      {detail ? <div className="mt-1 opacity-90">{detail}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
