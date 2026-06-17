type TauriWindow = Window & { __TAURI__?: unknown };

export interface TauriBadgeProps {
  connected: boolean;
  runtime?: boolean;
}

export function isTauriRuntime(win: TauriWindow | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  return Boolean(win?.__TAURI__);
}

export function TauriBadge({ connected, runtime = isTauriRuntime() }: TauriBadgeProps) {
  if (!runtime) return null;

  const status = connected ? 'connected' : 'disconnected';
  const dotClass = connected ? 'bg-ok-text shadow-emerald-900/20' : 'bg-err-text shadow-red-900/20';

  return (
    <div
      aria-label={`Desktop backend ${status}`}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-field/80 px-3 py-2 text-xs font-semibold text-text shadow-sm dark:bg-surface-muted"
    >
      <span>Desktop</span>
      <span className={`h-2 w-2 rounded-full shadow ${dotClass}`} aria-hidden="true" />
      <span className="capitalize text-text-muted">{status}</span>
    </div>
  );
}
