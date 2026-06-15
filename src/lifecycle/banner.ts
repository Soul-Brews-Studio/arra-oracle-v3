export interface BannerMiddleware {
  name: string;
  enabled?: boolean;
  detail?: string;
}

export interface StartupBannerOptions {
  version: string;
  port: number | string;
  profile: string;
  middleware: readonly (string | BannerMiddleware)[];
  dbStatus: string;
  docsPath?: string;
  log?: (message: string) => void;
}

export function formatStartupBanner(options: StartupBannerOptions): string {
  const docsPath = options.docsPath ?? '/api/docs';
  return [
    '╭────────────────────────────────────────────╮',
    '│ 🔮 Arra Oracle HTTP Server                 │',
    '╰────────────────────────────────────────────╯',
    `Version:    ${options.version}`,
    `Port:       ${options.port}`,
    `Profile:    ${options.profile}`,
    `Middleware: ${middlewareSummary(options.middleware)}`,
    `Database:   ${options.dbStatus}`,
    `Swagger:    ${docsPath}`,
  ].join('\n');
}

export function printStartupBanner(options: StartupBannerOptions): void {
  const log = options.log ?? console.log;
  log(formatStartupBanner(options));
}

function middlewareSummary(items: readonly (string | BannerMiddleware)[]): string {
  if (items.length === 0) return 'none';
  return items.map(formatMiddleware).join(', ');
}

function formatMiddleware(item: string | BannerMiddleware): string {
  if (typeof item === 'string') return item;
  const state = item.enabled === false ? 'off' : 'on';
  const detail = item.detail ? `:${item.detail}` : '';
  return `${item.name}:${state}${detail}`;
}
