import { Elysia } from 'elysia';
import { REQUEST_ID_HEADER, requestIdFor } from './correlation.ts';

export const DEFAULT_MAX_BODY_KB = 1024;
const BYTES_PER_KB = 1024;

export type BodyLimitEnv = Record<string, string | undefined>;

export type BodyLimitOptions = {
  env?: BodyLimitEnv;
  maxKb?: number;
};

export type PayloadTooLargeResponse = {
  error: 'Payload Too Large';
  message: string;
  statusCode: 413;
  correlationId: string;
  limitKb: number;
};

type HeaderSetter = { headers: Record<string, string | number>; status?: number | string };

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function maxBodyKbFromEnv(env: BodyLimitEnv = process.env): number {
  const raw = env.ARRA_MAX_BODY_KB?.trim();
  if (!raw) return DEFAULT_MAX_BODY_KB;
  if (!/^\d+$/.test(raw)) return DEFAULT_MAX_BODY_KB;

  const parsed = Number(raw);
  return isPositiveInteger(parsed) ? parsed : DEFAULT_MAX_BODY_KB;
}

function configuredMaxKb(options: BodyLimitOptions): number {
  if (options.maxKb === undefined) return maxBodyKbFromEnv(options.env);
  if (!isPositiveInteger(options.maxKb)) return DEFAULT_MAX_BODY_KB;
  return options.maxKb;
}

function parsedContentLength(request: Request): number | null {
  const raw = request.headers.get('content-length');
  if (!raw || !/^\d+$/.test(raw)) return null;

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function bodyExceedsLimit(request: Request, maxBytes: number): Promise<boolean> {
  const declaredLength = parsedContentLength(request);
  if (declaredLength !== null) return declaredLength > maxBytes;
  if (!request.body) return false;

  const reader = request.clone().body!.getReader();
  let total = 0;
  let chunk = await reader.read();

  while (!chunk.done) {
    total += chunk.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return true;
    }
    chunk = await reader.read();
  }

  return false;
}

function payloadTooLarge(request: Request, set: HeaderSetter, limitKb: number): PayloadTooLargeResponse {
  const correlationId = requestIdFor(request);
  set.status = 413;
  set.headers[REQUEST_ID_HEADER] = correlationId;
  set.headers['x-correlation-id'] = correlationId;
  return {
    error: 'Payload Too Large',
    message: `Request body exceeds ${limitKb}KB limit.`,
    statusCode: 413,
    correlationId,
    limitKb,
  };
}

export function createBodyLimitMiddleware(options: BodyLimitOptions = {}) {
  const maxKb = configuredMaxKb(options);
  const maxBytes = maxKb * BYTES_PER_KB;

  return new Elysia({ name: 'body-limit' }).onRequest(async ({ request, set }) => {
    if (await bodyExceedsLimit(request, maxBytes)) return payloadTooLarge(request, set, maxKb);
  });
}
