import type { BannerMiddleware } from './banner.ts';

export interface RuntimeMiddlewareOptions {
  rateLimitTokensPerWindow: number;
  gatewayEnabled: boolean;
}

export function readStartupDbStatus(ping: () => void): string {
  try {
    ping();
    return 'ok';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `degraded (${message})`;
  }
}

export function runtimeMiddleware(options: RuntimeMiddlewareOptions): BannerMiddleware[] {
  return [
    { name: 'request-logger' },
    { name: 'correlation' },
    { name: 'private-network-preflight' },
    { name: 'cors' },
    { name: 'body-limit' },
    { name: 'rate-limit', detail: `${options.rateLimitTokensPerWindow}/min` },
    { name: 'api-key-auth' },
    { name: 'metrics' },
    { name: 'compress' },
    { name: 'etag' },
    { name: 'structured-errors' },
    { name: 'not-found' },
    { name: 'swagger' },
    { name: 'gateway', enabled: options.gatewayEnabled },
  ];
}
