import { Elysia } from 'elysia';

export type StructuredRequestLogEntry = {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  timestamp: string;
};

type RequestMeta = { startedAt: number };
type LogSink = (entry: StructuredRequestLogEntry) => void;

type RequestLoggingOptions = {
  log?: LogSink;
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
  const log = options.log ?? ((entry: StructuredRequestLogEntry) => console.log(JSON.stringify(entry)));

  return new Elysia({ name: 'structured-request-logger' })
    .onRequest(({ request }) => {
      meta.set(request, { startedAt: now() });
    })
    .onAfterResponse({ as: 'global' }, ({ request, responseValue, set }) => {
      const endedAt = now();
      const startedAt = meta.get(request)?.startedAt ?? endedAt;
      log({
        method: request.method,
        path: requestPath(request),
        status: responseStatus(responseValue, set.status),
        durationMs: roundedDurationMs(startedAt, endedAt),
        timestamp: timestamp(),
      });
      meta.delete(request);
    });
}
