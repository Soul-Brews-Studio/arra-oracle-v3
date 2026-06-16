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
    <div className="rounded-xl border border-teal-600/20 bg-teal-50 p-5 text-sm text-teal-800 dark:border-teal-300/20 dark:bg-teal-300/5 dark:text-teal-100">
      <Spinner label={title} />
      {detail ? <p className="mt-2 text-teal-700/80 dark:text-teal-100/70">{detail}</p> : null}
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
    <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-400/30 dark:bg-red-950/40 dark:text-red-100" role="alert">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-red-700/80 dark:text-red-200/80">{message}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
