import { timingSafeEqual } from 'crypto';
import { apiErrorResponse } from '../middleware/errors.ts';

const OPEN_PREFIXES = ['/api/health', '/api/docs/'];

export function apiToken() { return process.env.ARRA_API_TOKEN?.trim() || ''; }
export function isApiTokenEnabled() { return apiToken().length > 0; }

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function isApiPathProtected(pathname: string) {
  if (!pathname.startsWith('/api/')) return false;
  if (OPEN_PREFIXES.some((prefix) => pathname === prefix.slice(0, -1) || pathname.startsWith(prefix))) return false;
  return true;
}

export function isApiAuthorized(request: Request) {
  const configured = apiToken();
  if (!configured) return true;
  const auth = request.headers.get('authorization') ?? '';
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return Boolean(bearer && safeEqual(bearer, configured));
}

export function unauthorizedApiResponse() {
  return apiErrorResponse('api_auth_required', 401, { message: 'ARRA API token required' });
}
