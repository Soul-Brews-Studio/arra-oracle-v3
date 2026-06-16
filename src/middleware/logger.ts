import { randomUUID } from 'node:crypto';
import { SANDBOX_LABEL_HEADER, sandboxLabel } from '../runtime/sandbox-label.ts';

export { SANDBOX_LABEL_HEADER, sandboxLabel } from '../runtime/sandbox-label.ts';

type RequestMeta = {
  startedAt: number;
  correlationId: string;
  headers: Record<string, string>;
  sandbox: string;
};

type RequestContext = {
  request: Request;
  set: { headers: Record<string, unknown> };
};

type AfterResponseContext = RequestContext & {
  responseValue: unknown;
  set: RequestContext['set'] & { status?: number | string };
};

export type RequestLogEntry = {
  event: 'http_request';
  method: string;
  path: string;
  status: number;
  durationMs: number;
  correlationId: string;
  headers: Record<string, string>;
  sandbox: string;
};

export const REQUEST_LOG_FORMATS = ['nginx', 'json', 'short'] as const;
export type RequestLogFormat = (typeof REQUEST_LOG_FORMATS)[number];

export type RequestLoggerOptions = {
  log?: (entry: RequestLogEntry) => void;
  logFormat?: RequestLogFormat;
  now?: () => number;
};

const REDACTED = '[REDACTED]';
const sensitiveHeaders = new Set(['authorization', 'proxy-authorization']);
const logFormats = new Set<RequestLogFormat>(REQUEST_LOG_FORMATS);

function nowMs(): number {
  return performance.now();
}

function safePath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return request.url;
  }
}

function redactHeaders(headers: Headers): Record<string, string> {
  const redacted: Record<string, string> = {};
  headers.forEach((value, key) => {
    const normalized = key.toLowerCase();
    redacted[normalized] = sensitiveHeaders.has(normalized) ? REDACTED : value;
  });
  return redacted;
}

function requestCorrelationId(request: Request): string {
  return request.headers.get('x-correlation-id') || request.headers.get('x-request-id') || randomUUID();
}

function responseStatus(responseValue: unknown, setStatus?: number | string): number {
  if (responseValue instanceof Response) return responseValue.status;
  if (typeof setStatus === 'number') return setStatus;
  return 200;
}

export function requestLogFormat(envValue = process.env.LOG_FORMAT): RequestLogFormat {
  const requested = envValue?.trim().toLowerCase() as RequestLogFormat | undefined;
  return requested && logFormats.has(requested) ? requested : 'nginx';
}

export function startupRequestLogFormat(env = process.env): RequestLogFormat {
  return requestLogFormat(env.LOG_FORMAT);
}

function formatDurationMs(durationMs: number): string {
  return `${Math.max(0, durationMs).toFixed(2).replace(/\.?0+$/, '')}ms`;
}

function shortCorrelationId(correlationId: string): string {
  return correlationId.slice(0, 8);
}

export function formatRequestLog(entry: RequestLogEntry, format: RequestLogFormat): string {
  if (format === 'nginx') {
    return [
      entry.method,
      entry.path,
      entry.status,
      formatDurationMs(entry.durationMs),
      `[${shortCorrelationId(entry.correlationId)}]`,
      `[${entry.sandbox}]`,
    ].join(' ');
  }

  if (format === 'short') {
    return [
      entry.status,
      entry.method,
      entry.path,
      `${Math.max(0, Math.round(entry.durationMs))}ms`,
    ].join(' ');
  }

  return JSON.stringify(entry);
}

export function createRequestLogger(options: RequestLoggerOptions = {}) {
  const metaByRequest = new WeakMap<Request, RequestMeta>();
  const now = options.now ?? nowMs;
  const format = options.logFormat ?? startupRequestLogFormat();
  const log = options.log ?? ((entry: RequestLogEntry) => console.log(formatRequestLog(entry, format)));

  return {
    onRequest({ request, set }: RequestContext) {
      const correlationId = requestCorrelationId(request);
      const sandbox = sandboxLabel();
      metaByRequest.set(request, { startedAt: now(), correlationId, headers: redactHeaders(request.headers), sandbox });
      set.headers['X-Correlation-Id'] = correlationId;
      set.headers[SANDBOX_LABEL_HEADER] = sandbox;
    },
    onAfterResponse({ request, responseValue, set }: AfterResponseContext) {
      const meta = metaByRequest.get(request);
      const endedAt = now();
      const startedAt = meta?.startedAt ?? endedAt;
      const durationMs = Math.max(0, Math.round((endedAt - startedAt) * 100) / 100);
      set.headers[SANDBOX_LABEL_HEADER] = meta?.sandbox ?? sandboxLabel();
      log({
        event: 'http_request',
        method: request.method,
        path: safePath(request),
        status: responseStatus(responseValue, set.status),
        durationMs,
        correlationId: meta?.correlationId ?? requestCorrelationId(request),
        headers: meta?.headers ?? redactHeaders(request.headers),
        sandbox: meta?.sandbox ?? sandboxLabel(),
      });
      metaByRequest.delete(request);
    },
  };
}
