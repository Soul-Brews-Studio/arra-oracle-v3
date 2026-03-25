/**
 * Auth Routes — helpers, middleware, auth endpoints, settings
 */

import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createHmac, timingSafeEqual } from 'crypto';
import { getSetting } from '../db/index.ts';

// Session secret - generate once per server run
const SESSION_SECRET = process.env.ORACLE_SESSION_SECRET || crypto.randomUUID();
const SESSION_COOKIE_NAME = 'oracle_session';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Check if request is from local network
// SECURITY: Only trust X-Forwarded-For behind a known reverse proxy
export function isLocalNetwork(c: Context): boolean {
  // Use the actual connection IP, not spoofable headers
  // Hono on Bun: c.env.remoteAddress gives the real client IP
  const connInfo = (c.env as any)?.remoteAddress;
  const ip = connInfo || '127.0.0.1';

  return ip === '127.0.0.1'
      || ip === '::1'
      || ip === 'localhost'
      || ip.startsWith('192.168.')
      || ip.startsWith('10.')
      || ip.startsWith('172.16.')
      || ip.startsWith('172.17.')
      || ip.startsWith('172.18.')
      || ip.startsWith('172.19.')
      || ip.startsWith('172.20.')
      || ip.startsWith('172.21.')
      || ip.startsWith('172.22.')
      || ip.startsWith('172.23.')
      || ip.startsWith('172.24.')
      || ip.startsWith('172.25.')
      || ip.startsWith('172.26.')
      || ip.startsWith('172.27.')
      || ip.startsWith('172.28.')
      || ip.startsWith('172.29.')
      || ip.startsWith('172.30.')
      || ip.startsWith('172.31.');
}

// Generate session token using HMAC-SHA256
export function generateSessionToken(): string {
  const expires = Date.now() + SESSION_DURATION_MS;
  const signature = createHmac('sha256', SESSION_SECRET)
    .update(String(expires))
    .digest('hex');
  return `${expires}:${signature}`;
}

// Verify session token with timing-safe comparison
export function verifySessionToken(token: string): boolean {
  if (!token) return false;
  const colonIdx = token.indexOf(':');
  if (colonIdx === -1) return false;

  const expiresStr = token.substring(0, colonIdx);
  const signature = token.substring(colonIdx + 1);
  const expires = parseInt(expiresStr, 10);
  if (isNaN(expires) || expires < Date.now()) return false;

  const expectedSignature = createHmac('sha256', SESSION_SECRET)
    .update(expiresStr)
    .digest('hex');

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(sigBuf, expectedBuf);
}

// Check if auth is required and user is authenticated
export function isAuthenticated(c: Context): boolean {
  const authEnabled = getSetting('auth_enabled') === 'true';
  if (!authEnabled) return true; // Auth not enabled, everyone is "authenticated"

  const localBypass = getSetting('auth_local_bypass') !== 'false'; // Default true
  if (localBypass && isLocalNetwork(c)) return true;

  const sessionCookie = getCookie(c, SESSION_COOKIE_NAME);
  return verifySessionToken(sessionCookie || '');
}

export function registerAuthRoutes(app: Hono) {
  // Auth Middleware (protects /api/* except auth routes)
  app.use('/api/*', async (c, next) => {
    const path = c.req.path;

    // Skip auth for certain endpoints
    const publicPaths = [
      '/api/auth/status',
      '/api/auth/login',
      '/api/health'
    ];
    if (publicPaths.some(p => path === p)) {
      return next();
    }

    if (!isAuthenticated(c)) {
      return c.json({ error: 'Unauthorized', requiresAuth: true }, 401);
    }

    return next();
  });

  // Auth status - public
  app.get('/api/auth/status', (c) => {
    const authEnabled = getSetting('auth_enabled') === 'true';
    const hasPassword = !!getSetting('auth_password_hash');
    const localBypass = getSetting('auth_local_bypass') !== 'false';
    const isLocal = isLocalNetwork(c);
    const authenticated = isAuthenticated(c);

    return c.json({
      authenticated,
      authEnabled,
      hasPassword,
      localBypass,
      isLocal
    });
  });

  // Login
  app.post('/api/auth/login', async (c) => {
    const body = await c.req.json();
    const { password } = body;

    if (!password) {
      return c.json({ success: false, error: 'Password required' }, 400);
    }

    const storedHash = getSetting('auth_password_hash');
    if (!storedHash) {
      return c.json({ success: false, error: 'No password configured' }, 400);
    }

    // Verify password using Bun's built-in password functions
    const valid = await Bun.password.verify(password, storedHash);
    if (!valid) {
      return c.json({ success: false, error: 'Invalid password' }, 401);
    }

    // Set session cookie
    const token = generateSessionToken();
    const isLocal = isLocalNetwork(c);
    setCookie(c, SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: !isLocal, // HTTPS required in production, allow HTTP for local dev
      sameSite: 'Lax',
      maxAge: SESSION_DURATION_MS / 1000,
      path: '/'
    });

    return c.json({ success: true });
  });

  // Logout
  app.post('/api/auth/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
    return c.json({ success: true });
  });

}
