import { REQUEST_ID_HEADER, requestIdFor } from './correlation.ts';
import type { StructuredErrorResponse } from './errors.ts';

const DEFAULT_TIMEOUT_MS = 30_000;

type FetchHandler = (request: Request) => Response | Promise<Response>;

export function requestTimeoutMsFromEnv(value = process.env.ARRA_REQUEST_TIMEOUT_MS): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_TIMEOUT_MS;
}

function timeoutBody(request: Request, timeoutMs: number): StructuredErrorResponse {
  return {
    success: false,
    error: 'Request Timeout',
    message: `Request exceeded ${timeoutMs}ms timeout`,
    statusCode: 408,
    correlationId: requestIdFor(request),
  };
}

function timeoutResponse(request: Request, timeoutMs: number): Response {
  const body = timeoutBody(request, timeoutMs);
  return Response.json(body, {
    status: 408,
    headers: {
      [REQUEST_ID_HEADER]: body.correlationId,
      'x-correlation-id': body.correlationId,
    },
  });
}

function requestWithSignal(request: Request, signal: AbortSignal): Request {
  return new Request(request, { signal });
}

export async function handleRequestTimeout(
  request: Request,
  next: FetchHandler,
  timeoutMs = requestTimeoutMsFromEnv(),
): Promise<Response> {
  const controller = new AbortController();
  const timedRequest = requestWithSignal(request, controller.signal);
  const response = Promise.resolve(next(timedRequest));
  response.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Response>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new Error('request timeout'));
      resolve(timeoutResponse(request, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([response, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createRequestTimeoutFetch(next: FetchHandler, timeoutMs = requestTimeoutMsFromEnv()): FetchHandler {
  return (request) => handleRequestTimeout(request, next, timeoutMs);
}
