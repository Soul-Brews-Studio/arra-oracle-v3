import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://studio.buildwithoracle.com',
  'https://neo.buildwithoracle.com',
];

function allowedOrigins(): string[] {
  const envExtraOrigins = (process.env.ORACLE_CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const legacyOrigin = process.env.CORS_ORIGIN?.trim();
  return [
    ...DEFAULT_ALLOWED_ORIGINS,
    ...envExtraOrigins,
    ...(legacyOrigin ? [legacyOrigin] : []),
  ];
}

export function originAllowed(origin: string | undefined | null): string | null {
  if (!origin) return null;
  if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) return origin;
  if (allowedOrigins().includes(origin)) return origin;
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol === 'https:' && (hostname === 'buildwithoracle.com' || hostname.endsWith('.buildwithoracle.com'))) {
      return origin;
    }
  } catch {}
  return null;
}

export function createPrivateNetworkPreflightMiddleware() {
  return new Elysia().onRequest(({ request }) => {
    if (
      request.method === 'OPTIONS' &&
      request.headers.get('access-control-request-private-network') === 'true'
    ) {
      const origin = originAllowed(request.headers.get('origin'));
      if (!origin) return;
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
          'Access-Control-Allow-Headers':
            request.headers.get('access-control-request-headers') ?? 'content-type',
          'Access-Control-Allow-Private-Network': 'true',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        },
      });
    }
  });
}

export function createCorsMiddleware() {
  return cors({
    origin: (request) => originAllowed(request.headers.get('origin')) !== null,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });
}
