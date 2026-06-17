import type { ReactNode } from 'react';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2" role="status" aria-label={label}>
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <span>{label}</span>
    </span>
  );
}

export function LoadingPanel({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-accent-border bg-accent-soft p-5 text-sm text-accent dark:border-accent-border dark:bg-accent-soft dark:text-accent">
      <Spinner label={title} />
      {detail ? <p className="mt-2 text-accent">{detail}</p> : null}
    </div>
  );
}

export function ErrorMessage({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-err-border bg-err-bg p-4 text-sm text-err-text dark:border-err-border dark:bg-err-bg dark:text-err-text" role="alert">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-err-text">{message}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
