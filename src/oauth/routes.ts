/**
 * OAuth 2.1 Hono routes for Oracle v3
 *
 * Registers all OAuth endpoints on the Hono app.
 * Only mounted when MCP_OAUTH_PIN is set.
 *
 * Endpoints:
 *   GET  /.well-known/oauth-authorization-server  — AS metadata
 *   GET  /.well-known/oauth-protected-resource    — Resource metadata
 *   POST /register                                — Dynamic client registration (RFC 7591, Bearer-protected)
 *   GET  /authorize                               — Authorization endpoint
 *   POST /token                                   — Token endpoint
 *   POST /revoke                                  — Revocation endpoint
 *   GET  /oauth/login                             — PIN entry page
 *   POST /oauth/callback                          — PIN verification + redirect (rate-limited)
 */

import type { Context, Hono } from 'hono';
import { MCP_EXTERNAL_URL } from '../config.ts';
import { getOAuthProvider } from './provider.ts';

/** Extract best-effort client IP from request headers */
function getClientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return c.req.header('x-real-ip') ?? 'unknown';
}

export function registerOAuthRoutes(app: Hono): void {
  // ─── Discovery metadata ────────────────────────────────────────────────

  app.get('/.well-known/oauth-authorization-server', (c) => {
    return c.json({
      issuer: MCP_EXTERNAL_URL,
      authorization_endpoint: `${MCP_EXTERNAL_URL}/authorize`,
      token_endpoint: `${MCP_EXTERNAL_URL}/token`,
      registration_endpoint: `${MCP_EXTERNAL_URL}/register`,
      revocation_endpoint: `${MCP_EXTERNAL_URL}/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['read', 'write'],
    });
  });

  app.get('/.well-known/oauth-protected-resource', (c) => {
    return c.json({
      resource: MCP_EXTERNAL_URL,
      authorization_servers: [MCP_EXTERNAL_URL],
      scopes_supported: ['read', 'write'],
      bearer_methods_supported: ['header'],
    });
  });

  // ─── Dynamic client registration (RFC 7591) ───────────────────────────
  // Protected: requires Bearer MCP_AUTH_TOKEN to prevent open registration abuse.

  app.post('/register', async (c) => {
    const provider = getOAuthProvider();

    // Require Bearer auth for registration
    const authHeader = c.req.header('Authorization') ?? '';
    if (!provider.checkRegistrationAuth(authHeader)) {
      return c.json(
        { error: 'unauthorized', error_description: 'Client registration requires a valid Bearer token' },
        401,
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_request: body must be JSON' }, 400);
    }

    const redirect_uris = body.redirect_uris;
    if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      return c.json({ error: 'invalid_client_metadata: redirect_uris required' }, 400);
    }

    const client = provider.registerClient({
      redirect_uris: redirect_uris as string[],
      client_name: body.client_name as string | undefined,
      grant_types: body.grant_types as string[] | undefined,
      response_types: body.response_types as string[] | undefined,
      scope: body.scope as string | undefined,
      token_endpoint_auth_method: body.token_endpoint_auth_method as string | undefined,
    });

    return c.json(client, 201);
  });

  // ─── Authorization endpoint ───────────────────────────────────────────

  app.get('/authorize', (c) => {
    const client_id = c.req.query('client_id') || '';
    const redirect_uri = c.req.query('redirect_uri') || '';
    const scope = c.req.query('scope');
    const state = c.req.query('state');
    const code_challenge = c.req.query('code_challenge') || '';
    const code_challenge_method = c.req.query('code_challenge_method') || '';
    const resource = c.req.query('resource');
    const response_type = c.req.query('response_type');

    if (response_type !== 'code') {
      return c.json({ error: 'unsupported_response_type' }, 400);
    }

    const provider = getOAuthProvider();
    const result = provider.authorize({
      client_id,
      redirect_uri,
      scope,
      state,
      code_challenge,
      code_challenge_method,
      resource,
    });

    if ('error' in result) {
      return c.json({ error: result.error }, 400);
    }

    return c.redirect(result.loginUrl, 302);
  });

  // ─── Token endpoint ───────────────────────────────────────────────────

  app.post('/token', async (c) => {
    let params: Record<string, string>;

    const contentType = c.req.header('Content-Type') || '';
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await c.req.text();
      params = Object.fromEntries(new URLSearchParams(text));
    } else {
      // Try JSON fallback
      try {
        params = await c.req.json() as Record<string, string>;
      } catch {
        return c.json({ error: 'invalid_request: unsupported content type' }, 400);
      }
    }

    const grant_type = params.grant_type;
    if (grant_type !== 'authorization_code') {
      return c.json({ error: 'unsupported_grant_type' }, 400);
    }

    const code = params.code;
    const client_id = params.client_id;
    const code_verifier = params.code_verifier;
    const redirect_uri = params.redirect_uri;

    if (!code || !client_id || !code_verifier || !redirect_uri) {
      return c.json({ error: 'invalid_request: missing required parameters' }, 400);
    }

    const provider = getOAuthProvider();
    const result = provider.exchangeAuthorizationCode({
      client_id,
      code,
      code_verifier,
      redirect_uri,
    });

    if ('error' in result) {
      return c.json({ error: result.error }, result.status as 400 | 503);
    }

    return c.json(result);
  });

  // ─── Token revocation ─────────────────────────────────────────────────

  app.post('/revoke', async (c) => {
    let token: string | undefined;

    const contentType = c.req.header('Content-Type') || '';
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await c.req.text();
      const params = new URLSearchParams(text);
      token = params.get('token') ?? undefined;
    } else {
      try {
        const body = await c.req.json() as Record<string, string>;
        token = body.token;
      } catch {
        // ignore
      }
    }

    if (token) {
      getOAuthProvider().revokeToken(token);
    }

    // RFC 7009: always return 200 even if token unknown
    return c.json({}, 200);
  });

  // ─── PIN login page ───────────────────────────────────────────────────

  app.get('/oauth/login', (c) => {
    const stateKey = c.req.query('state') || '';
    const provider = getOAuthProvider();
    const html = provider.getLoginPage(stateKey);
    return c.html(html);
  });

  app.post('/oauth/callback', async (c) => {
    let stateKey: string;
    let pin: string;

    const contentType = c.req.header('Content-Type') || '';
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await c.req.text();
      const params = new URLSearchParams(text);
      stateKey = params.get('state') || '';
      pin = params.get('pin') || '';
    } else {
      try {
        const body = await c.req.json() as Record<string, string>;
        stateKey = body.state || '';
        pin = body.pin || '';
      } catch {
        return c.json({ error: 'invalid_request' }, 400);
      }
    }

    const ip = getClientIp(c);
    const provider = getOAuthProvider();
    const result = provider.handleLoginCallback(stateKey, pin, ip);

    if ('error' in result) {
      if (result.showLoginPage) {
        // Re-render login page with error message
        const html = provider.getLoginPage(stateKey, result.error);
        return c.html(html, result.status as 200 | 400 | 403 | 429 | 503);
      }
      return c.json({ error: result.error }, result.status as 400 | 403 | 429 | 503);
    }

    return c.redirect(result.redirectUri, 302);
  });
}
