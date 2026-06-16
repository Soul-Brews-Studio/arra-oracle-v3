import { randomUUID } from 'node:crypto';
import { Elysia } from 'elysia';
import { formatRequestLog, startupRequestLogFormat, type RequestLogFormat } from './logger.ts';
import { SANDBOX_LABEL_HEADER, sandboxLabel } from '../runtime/sandbox-label.ts';

export type StructuredRequestLogEntry = {
  event: 'http_request';
  method: string;
  path: string;
  status: number;
  durationMs: number;
  timestamp: string;
  correlationId: string;
  headers: Record<string, string>;
  sandbox: string;
};

type RequestMeta = {
  startedAt: number;
  correlationId: string;
  headers: Record<string, string>;
  sandbox: string;
};
type LogSink = (entry: StructuredRequestLogEntry) => void;

type RequestLoggingOptions = {
  log?: LogSink;
  logFormat?: RequestLogFormat;
  now?: () => number;
  timestamp?: () => string;
};

function nowMs(): number {
  return performance.now();
}

function isoTimestamp(): string {
  return new Date().toISOString();
}

function requestPath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return request.url;
  }
}

const REDACTED = '[REDACTED]';
const sensitiveHeaders = new Set(['authorization', 'proxy-authorization']);

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

function responseStatus(response: unknown, setStatus: unknown): number {
  if (response instanceof Response) return response.status;
  if (typeof setStatus === 'number') return setStatus;
  return 200;
}

function roundedDurationMs(startedAt: number, endedAt: number): number {
  return Math.max(0, Math.round((endedAt - startedAt) * 100) / 100);
}

export function createRequestLoggingMiddleware(options: RequestLoggingOptions = {}) {
  const meta = new WeakMap<Request, RequestMeta>();
  const now = options.now ?? nowMs;
  const timestamp = options.timestamp ?? isoTimestamp;
  const format = options.logFormat ?? startupRequestLogFormat();
  const log = options.log ?? ((entry: StructuredRequestLogEntry) => console.log(formatRequestLog(entry, format)));

  return new Elysia({ name: 'structured-request-logger' })
    .onRequest(({ request, set }) => {
      const correlationId = requestCorrelationId(request);
      const sandbox = sandboxLabel();
      meta.set(request, { startedAt: now(), correlationId, headers: redactHeaders(request.headers), sandbox });
      set.headers['X-Correlation-Id'] = correlationId;
      set.headers[SANDBOX_LABEL_HEADER] = sandbox;
    })
    .onAfterResponse({ as: 'global' }, ({ request, responseValue, set }) => {
      const endedAt = now();
      const requestMeta = meta.get(request);
      const startedAt = requestMeta?.startedAt ?? endedAt;
      set.headers[SANDBOX_LABEL_HEADER] = requestMeta?.sandbox ?? sandboxLabel();
      log({
        event: 'http_request',
        method: request.method,
        path: requestPath(request),
        status: responseStatus(responseValue, set.status),
        durationMs: roundedDurationMs(startedAt, endedAt),
        timestamp: timestamp(),
        correlationId: requestMeta?.correlationId ?? requestCorrelationId(request),
        headers: requestMeta?.headers ?? redactHeaders(request.headers),
        sandbox: requestMeta?.sandbox ?? sandboxLabel(),
      });
      meta.delete(request);
    });
}
