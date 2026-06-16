import { Elysia } from 'elysia';

const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:4321',
  'http://127.0.0.1:4321',
] as const;
const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
const ALLOWED_HEADERS = [
  'authorization',
  'content-type',
  'x-correlation-id',
  'x-request-id',
  'x-requested-with',
  'x-tenant-id',
] as const;
const MAX_AGE_SECONDS = '86400';

export interface CorsPolicy {
  wildcard: false;
  origins: string[];
}

function configuredOrigins(): string | undefined {
  return process.env.ARRA_CORS_ORIGINS
    ?? process.env.ORACLE_CORS_ORIGIN
    ?? process.env.CORS_ORIGIN;
}

function splitCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function allowedRequestHeaders(request: Request): string[] | null {
  const requested = request.headers.get('access-control-request-headers');
  if (!requested) return [...ALLOWED_HEADERS];
  const headers = splitCsv(requested).map((header) => header.toLowerCase());
  const allowed = new Set<string>(ALLOWED_HEADERS);
  return headers.every((header) => allowed.has(header)) ? headers : null;
}

function allowsRequestMethod(request: Request): boolean {
  const requested = request.headers.get('access-control-request-method');
  if (!requested) return true;
  return ALLOWED_METHODS.includes(requested.toUpperCase() as typeof ALLOWED_METHODS[number]);
}

export function parseCorsOrigins(value = configuredOrigins()): CorsPolicy {
  const origins = value?.trim() ? splitCsv(value) : [...DEFAULT_ORIGINS];
  return {
    wildcard: false,
    origins: origins.filter((origin) => origin !== '*'),
  };
}

export function allowedCorsOrigin(origin: string | null | undefined, policy = parseCorsOrigins()): string | null {
  if (!origin) return null;
  return policy.origins.includes(origin) ? origin : null;
}

type MutableHeaders = Record<string, string | number | string[]>;

function appendVary(headers: MutableHeaders, value: string): void {
  const current = headers.Vary ?? headers.vary;
  const currentValue = current == null ? '' : Array.isArray(current) ? current.join(', ') : String(current);
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
  const allowedHeaders = allowedRequestHeaders(request);
  if (!origin || !allowedHeaders || !allowsRequestMethod(request)) return false;

  headers['Access-Control-Allow-Origin'] = origin;
  headers['Access-Control-Allow-Methods'] = ALLOWED_METHODS.join(',');
  headers['Access-Control-Allow-Headers'] = allowedHeaders.join(',');
  headers['Access-Control-Allow-Credentials'] = 'true';
  appendVary(headers, 'Origin');
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
