import { randomUUID } from 'node:crypto';

type RequestMeta = {
  startedAt: number;
  correlationId: string;
  headers: Record<string, string>;
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
};

export type RequestLoggerOptions = {
  log?: (entry: RequestLogEntry) => void;
};

const REDACTED = '[REDACTED]';
const sensitiveHeaders = new Set(['authorization', 'proxy-authorization']);

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

export function createRequestLogger(options: RequestLoggerOptions = {}) {
  const metaByRequest = new WeakMap<Request, RequestMeta>();
  const log = options.log ?? ((entry: RequestLogEntry) => console.log(JSON.stringify(entry)));

  return {
    onRequest({ request, set }: RequestContext) {
      const correlationId = requestCorrelationId(request);
      metaByRequest.set(request, { startedAt: nowMs(), correlationId, headers: redactHeaders(request.headers) });
      set.headers['X-Correlation-Id'] = correlationId;
    },
    onAfterResponse({ request, responseValue, set }: AfterResponseContext) {
      const meta = metaByRequest.get(request);
      const endedAt = nowMs();
      const startedAt = meta?.startedAt ?? endedAt;
      const durationMs = Math.max(0, Math.round((endedAt - startedAt) * 100) / 100);
      log({
        event: 'http_request',
        method: request.method,
        path: safePath(request),
        status: responseStatus(responseValue, set.status),
        durationMs,
        correlationId: meta?.correlationId ?? requestCorrelationId(request),
        headers: meta?.headers ?? redactHeaders(request.headers),
      });
      metaByRequest.delete(request);
    },
  };
}
