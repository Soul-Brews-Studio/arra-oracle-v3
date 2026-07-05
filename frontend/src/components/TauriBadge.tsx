import { Badge } from './Badge';

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

  return (
    <Badge ariaLabel={`Desktop backend ${status}`} dot tone={connected ? 'success' : 'danger'} className="px-3 py-2 shadow-sm">
      <span>Desktop</span>
      <span className="capitalize">{status}</span>
    </Badge>
  );
}
