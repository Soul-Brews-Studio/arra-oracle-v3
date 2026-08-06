import { Elysia } from 'elysia';

const HSTS_VALUE = 'max-age=31536000; includeSubDomains';

type MutableHeaders = Record<string, string | number | string[]>;

export function isHstsEnabled(value = process.env.ARRA_HSTS): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function applySecurityHeaders(headers: MutableHeaders, hstsEnabled: boolean): void {
  headers['X-Content-Type-Options'] = 'nosniff';
  headers['X-Frame-Options'] = 'DENY';
  headers['X-XSS-Protection'] = '0';
  if (hstsEnabled) headers['Strict-Transport-Security'] = HSTS_VALUE;
}

export function createSecurityHeadersMiddleware(hstsEnabled = isHstsEnabled()) {
  return new Elysia({ name: 'security-headers' })
    .onAfterHandle({ as: 'global' }, ({ set }) => {
      applySecurityHeaders(set.headers, hstsEnabled);
    })
    .onError({ as: 'global' }, ({ set }) => {
      applySecurityHeaders(set.headers, hstsEnabled);
    });
}
