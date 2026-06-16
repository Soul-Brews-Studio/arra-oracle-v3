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
  const dotClass = connected ? 'bg-emerald-400 shadow-emerald-400/40' : 'bg-red-400 shadow-red-400/40';

  return (
    <div
      aria-label={`Desktop backend ${status}`}
      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/80 px-3 py-2 text-xs font-semibold text-slate-100 shadow-sm dark:bg-white/5"
    >
      <span>Desktop</span>
      <span className={`h-2 w-2 rounded-full shadow ${dotClass}`} aria-hidden="true" />
      <span className="capitalize text-slate-300">{status}</span>
    </div>
  );
}
