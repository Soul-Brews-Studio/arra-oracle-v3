import { Elysia } from 'elysia';

export const REQUEST_ID_HEADER = 'X-Request-Id';
const LEGACY_CORRELATION_HEADER = 'x-correlation-id';

const requestIds = new WeakMap<Request, string>();

export type RequestCorrelationStore = {
  requestId: string;
};

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

function setRequestIdHeader(set: { headers: Record<string, string | number> }, requestId: string) {
  set.headers[REQUEST_ID_HEADER] = requestId;
}

export function createCorrelationMiddleware() {
  return new Elysia({ name: 'request-correlation' })
    .state({ requestId: '' })
    .onRequest(({ request, set, store }) => {
      const requestId = rememberRequestId(request, createRequestId());
      (store as RequestCorrelationStore).requestId = requestId;
      setRequestIdHeader(set, requestId);
    })
    .derive({ as: 'global' }, ({ request, store }) => {
      const requestId = requestIdFor(request);
      (store as RequestCorrelationStore).requestId = requestId;
      return { requestId };
    })
    .onAfterHandle({ as: 'global' }, ({ request, set }) => {
      setRequestIdHeader(set, requestIdFor(request));
    });
}
