import { Elysia } from 'elysia';

export const REQUEST_ID_HEADER = 'X-Request-Id';
export const RESPONSE_TIME_HEADER = 'X-Response-Time';
const LEGACY_CORRELATION_HEADER = 'x-correlation-id';

const requestIds = new WeakMap<Request, string>();
const requestStarts = new WeakMap<Request, number>();

export type RequestCorrelationStore = {
  requestId: string;
  requestStartedAtMs: number;
  responseTimeMs: number;
};

type MutableHeadersSet = { headers: Record<string, string | number> };
type ResponseTimingObserver = (entry: {
  method: string;
  pathname: string;
  requestId: string;
  responseTimeMs: number;
}) => void;

export function createRequestId(): string {
  return crypto.randomUUID();
}

export function rememberRequestId(request: Request, requestId: string): string {
  requestIds.set(request, requestId);
  return requestId;
}

export function requestIdFor(request: Request): string {
  const known = requestIds.get(request);
  if (known) return known;

  const inbound = request.headers.get(REQUEST_ID_HEADER)
    ?? request.headers.get(LEGACY_CORRELATION_HEADER)
    ?? createRequestId();
  return rememberRequestId(request, inbound);
}

export function rememberRequestStart(request: Request, startedAtMs = performance.now()): number {
  requestStarts.set(request, startedAtMs);
  return startedAtMs;
}

export function requestStartedAtFor(request: Request): number {
  const known = requestStarts.get(request);
  return known ?? rememberRequestStart(request);
}

export function responseTimeMsFor(request: Request): number {
  return Math.max(0, performance.now() - requestStartedAtFor(request));
}

export function formatResponseTime(ms: number): string {
  return `${Math.max(0, ms).toFixed(1)}ms`;
}

export function responseTimeFor(request: Request): string {
  return formatResponseTime(responseTimeMsFor(request));
}

function setRequestIdHeader(set: MutableHeadersSet, requestId: string) {
  set.headers[REQUEST_ID_HEADER] = requestId;
}

function setResponseTimeHeader(set: MutableHeadersSet, request: Request) {
  set.headers[RESPONSE_TIME_HEADER] = responseTimeFor(request);
}

function updateStore(store: unknown, request: Request, requestId: string) {
  const target = store as RequestCorrelationStore;
  target.requestId = requestId;
  target.requestStartedAtMs = requestStartedAtFor(request);
  target.responseTimeMs = responseTimeMsFor(request);
}

export function createCorrelationMiddleware(observer?: ResponseTimingObserver) {
  return new Elysia({ name: 'request-correlation' })
    .state({ requestId: '', requestStartedAtMs: 0, responseTimeMs: 0 })
    .onRequest(({ request, set, store }) => {
      const requestId = requestIdFor(request);
      rememberRequestStart(request);
      updateStore(store, request, requestId);
      setRequestIdHeader(set, requestId);
      setResponseTimeHeader(set, request);
    })
    .derive({ as: 'global' }, ({ request, store }) => {
      const requestId = requestIdFor(request);
      updateStore(store, request, requestId);
      return { requestId };
    })
    .onAfterHandle({ as: 'global' }, ({ request, set, store }) => {
      const requestId = requestIdFor(request);
      updateStore(store, request, requestId);
      setRequestIdHeader(set, requestId);
      setResponseTimeHeader(set, request);
    })
    .onAfterResponse({ as: 'global' }, ({ request, store }) => {
      const requestId = requestIdFor(request);
      updateStore(store, request, requestId);
      const { pathname } = new URL(request.url);
      observer?.({ method: request.method, pathname, requestId, responseTimeMs: responseTimeMsFor(request) });
    });
}
