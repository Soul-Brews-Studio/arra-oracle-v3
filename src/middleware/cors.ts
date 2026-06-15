import { Elysia } from 'elysia';

const DEFAULT_ORIGINS = '*';
const DEFAULT_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
const DEFAULT_HEADERS = 'content-type,authorization,x-requested-with,x-correlation-id';
const MAX_AGE_SECONDS = '86400';

export interface CorsPolicy {
  wildcard: boolean;
  origins: string[];
}

export function parseCorsOrigins(value = process.env.ARRA_CORS_ORIGINS): CorsPolicy {
  const raw = value?.trim() || DEFAULT_ORIGINS;
  const origins = raw.split(',').map(origin => origin.trim()).filter(Boolean);
  return {
    wildcard: origins.length === 0 || origins.includes('*'),
    origins: origins.filter(origin => origin !== '*'),
  };
}

export function allowedCorsOrigin(origin: string | null | undefined, policy = parseCorsOrigins()): string | null {
  if (policy.wildcard) return '*';
  if (!origin) return null;
  return policy.origins.includes(origin) ? origin : null;
}

type MutableHeaders = Record<string, string | number | string[]>;

function appendVary(headers: MutableHeaders, value: string): void {
  const current = headers.Vary ?? headers.vary;
  const currentValue = Array.isArray(current) ? current.join(', ') : String(current);
  if (!currentValue) {
    headers.Vary = value;
    return;
  }
  const parts = currentValue.split(',').map((part: string) => part.trim().toLowerCase());
  if (!parts.includes(value.toLowerCase())) headers.Vary = `${currentValue}, ${value}`;
}

function applyCorsHeaders(
  headers: MutableHeaders,
  request: Request,
  policy: CorsPolicy,
): boolean {
  const origin = allowedCorsOrigin(request.headers.get('origin'), policy);
  if (!origin) return false;

  headers['Access-Control-Allow-Origin'] = origin;
  headers['Access-Control-Allow-Methods'] = DEFAULT_METHODS;
  headers['Access-Control-Allow-Headers'] = request.headers.get('access-control-request-headers') ?? DEFAULT_HEADERS;
  if (origin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
    appendVary(headers, 'Origin');
  }
  return true;
}

function preflightResponse(request: Request, policy: CorsPolicy): Response {
  const headers: Record<string, string> = {
    'Access-Control-Max-Age': MAX_AGE_SECONDS,
  };
  const allowed = applyCorsHeaders(headers, request, policy);
  if (allowed && request.headers.get('access-control-request-private-network') === 'true') {
    headers['Access-Control-Allow-Private-Network'] = 'true';
  }
  return new Response(null, { status: 204, headers });
}

export function createCorsMiddleware(policy = parseCorsOrigins()) {
  return new Elysia({ name: 'cors' })
    .onRequest(({ request }) => {
      if (request.method === 'OPTIONS') return preflightResponse(request, policy);
    })
    .onAfterHandle({ as: 'global' }, ({ request, set }) => {
      applyCorsHeaders(set.headers, request, policy);
    })
    .onError({ as: 'global' }, ({ request, set }) => {
      applyCorsHeaders(set.headers, request, policy);
    });
}

export function createPrivateNetworkPreflightMiddleware(policy = parseCorsOrigins()) {
  return new Elysia({ name: 'private-network-preflight' }).onRequest(({ request }) => {
    if (
      request.method === 'OPTIONS' &&
      request.headers.get('access-control-request-private-network') === 'true'
    ) {
      return preflightResponse(request, policy);
    }
  });
}
