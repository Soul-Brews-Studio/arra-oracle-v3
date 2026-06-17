import { timingSafeEqual } from 'crypto';
import { Elysia } from 'elysia';
import { apiErrorResponse } from './errors.ts';

const HEALTH_BYPASS_PATH = '/api/health';

type AuthFailureReason = 'missing' | 'invalid';
type BearerAuth = { present: boolean; token: string };

export function configuredApiKey(): string {
  return process.env.ARRA_API_KEY?.trim() ?? '';
}

export function isApiKeyAuthEnabled(): boolean {
  return configuredApiKey().length > 0;
}

export function isApiKeyAuthBypassed(pathname: string): boolean {
  return pathname === HEALTH_BYPASS_PATH || pathname.startsWith(`${HEALTH_BYPASS_PATH}/`);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function bearerAuth(request: Request): BearerAuth {
  const value = request.headers.get('authorization')?.trim() ?? '';
  if (!value) return { present: false, token: '' };
  const token = value.match(/^Bearer\s+([^\s,]+)\s*$/i)?.[1] ?? '';
  return { present: true, token };
}

export function isApiKeyAuthorized(request: Request): boolean {
  const expected = configuredApiKey();
  if (!expected) return true;
  const token = bearerAuth(request).token;
  return token.length > 0 && safeEqual(token, expected);
}

export function apiKeyUnauthorizedResponse(reason: AuthFailureReason) {
  return apiErrorResponse('api_key_auth_required', 401, {
    reason,
    message: reason === 'missing'
      ? 'Authorization: Bearer token required'
      : 'Invalid API key',
  });
}

export function createApiKeyAuthMiddleware() {
  return new Elysia().onBeforeHandle({ as: 'global' }, ({ request, set }) => {
    const key = configuredApiKey();
    const pathname = new URL(request.url).pathname;
    if (!key || isApiKeyAuthBypassed(pathname)) return;

    const auth = bearerAuth(request);
    const token = auth.token;
    if (token && safeEqual(token, key)) return;

    set.status = 401;
    return apiKeyUnauthorizedResponse(auth.present ? 'invalid' : 'missing');
  });
}
