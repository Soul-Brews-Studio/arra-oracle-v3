/**
 * OAuth 2.1 Provider for Oracle v3
 *
 * PIN-based authorization server. Mirrors PSak Soul MCP oauth_provider.py.
 * Supports dynamic client registration (RFC 7591), PKCE (S256), and
 * 30-day access tokens. State persists to ORACLE_DATA_DIR/.oauth-state.json.
 *
 * Design decisions:
 * - No refresh tokens (30-day access tokens sufficient for personal server)
 * - Single PIN, single user (same as PSak)
 * - Atomic file writes for crash safety (temp file + rename)
 * - crypto.timingSafeEqual for PIN comparison to prevent timing attacks
 */

import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { writeFileSync, readFileSync, renameSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';

import { MCP_OAUTH_PIN, MCP_EXTERNAL_URL, ORACLE_DATA_DIR, MCP_AUTH_TOKEN } from '../config.ts';
import type { OAuthState, OAuthClientInfo, PendingAuthorization } from './types.ts';

export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const AUTH_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface AuthInfo {
  token: string;
  client_id: string;
  scopes: string[];
  expires_at: number;
}

/** Issued code data stored until token exchange */
interface IssuedCode {
  client_id: string;
  redirect_uri: string;
  scopes: string[];
  code_challenge: string;
  resource?: string;
  issued_at: number;
}

export class OAuthProvider {
  private readonly stateFile: string;
  private state: OAuthState;
  // stateKey → pending auth (before PIN verification)
  private pendingAuthorizations: Map<string, PendingAuthorization> = new Map();
  // code → issued code data (after PIN verification, before token exchange)
  private issuedCodes: Map<string, IssuedCode> = new Map();

  constructor() {
    this.stateFile = join(ORACLE_DATA_DIR, '.oauth-state.json');
    this.state = this.loadState();
    this.cleanExpiredTokens();
  }

  // ─── State persistence ───────────────────────────────────────────────────

  private loadState(): OAuthState {
    if (!existsSync(this.stateFile)) {
      return { clients: {}, tokens: {} };
    }
    try {
      const raw = readFileSync(this.stateFile, 'utf-8');
      return JSON.parse(raw) as OAuthState;
    } catch {
      return { clients: {}, tokens: {} };
    }
  }

  /** Atomic write: write to temp file then rename — crash-safe. */
  private saveState(): void {
    const dir = dirname(this.stateFile);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const tmp = join(tmpdir(), `.oauth-state-${Date.now()}-${randomBytes(4).toString('hex')}.tmp`);
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf-8');
    renameSync(tmp, this.stateFile);
  }

  private cleanExpiredTokens(): void {
    const now = Date.now();
    let changed = false;
    for (const [token, data] of Object.entries(this.state.tokens)) {
      if (data.expires_at < now) {
        delete this.state.tokens[token];
        changed = true;
      }
    }
    if (changed) this.saveState();

    // Clean expired pending authorizations
    for (const [stateKey, pending] of this.pendingAuthorizations.entries()) {
      if (now - pending.created_at > AUTH_CODE_TTL_MS) {
        this.pendingAuthorizations.delete(stateKey);
      }
    }
  }

  // ─── Client registration (RFC 7591) ─────────────────────────────────────

  registerClient(metadata: Partial<OAuthClientInfo>): OAuthClientInfo {
    const client_id = `oracle-${randomBytes(12).toString('hex')}`;
    const client_secret = randomBytes(24).toString('hex');

    const client: OAuthClientInfo = {
      client_id,
      client_secret,
      redirect_uris: metadata.redirect_uris || [],
      client_name: metadata.client_name,
      grant_types: metadata.grant_types || ['authorization_code'],
      response_types: metadata.response_types || ['code'],
      scope: metadata.scope || 'read write',
      token_endpoint_auth_method: metadata.token_endpoint_auth_method || 'client_secret_post',
    };

    this.state.clients[client_id] = client;
    this.saveState();

    return client;
  }

  getClient(client_id: string): OAuthClientInfo | null {
    return this.state.clients[client_id] ?? null;
  }

  // ─── Authorization ───────────────────────────────────────────────────────

  /**
   * Validate authorization request and store pending auth.
   * Returns the login page URL with state key, or an error.
   */
  authorize(params: {
    client_id: string;
    redirect_uri: string;
    scope?: string;
    state?: string;
    code_challenge: string;
    code_challenge_method: string;
    resource?: string;
  }): { loginUrl: string } | { error: string } {
    const client = this.getClient(params.client_id);
    if (!client) {
      return { error: `Unknown client_id: ${params.client_id}` };
    }

    if (!client.redirect_uris.includes(params.redirect_uri)) {
      return { error: 'redirect_uri not registered for client' };
    }

    if (params.code_challenge_method !== 'S256') {
      return { error: 'Only S256 code_challenge_method is supported' };
    }

    if (!params.code_challenge) {
      return { error: 'code_challenge is required' };
    }

    const stateKey = randomBytes(16).toString('hex');
    const scopes = (params.scope || 'read write').split(' ').filter(Boolean);

    this.pendingAuthorizations.set(stateKey, {
      client_id: params.client_id,
      state: params.state,
      scopes,
      code_challenge: params.code_challenge,
      redirect_uri: params.redirect_uri,
      resource: params.resource,
      created_at: Date.now(),
    });

    const loginUrl = `${MCP_EXTERNAL_URL}/oauth/login?state=${stateKey}`;
    return { loginUrl };
  }

  // ─── PIN login page ──────────────────────────────────────────────────────

  getLoginPage(stateKey: string, errorMessage?: string): string {
    const pending = this.pendingAuthorizations.get(stateKey);
    if (!pending) {
      return `<!DOCTYPE html><html><body><h1>Error</h1><p>Invalid or expired state. Please restart the authorization flow.</p></body></html>`;
    }

    const errorHtml = errorMessage
      ? `<p class="error">${errorMessage}</p>`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Oracle v3 — Authorize</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 2rem; width: 100%; max-width: 400px; }
    h1 { font-size: 1.4rem; color: #a78bfa; margin-bottom: 0.5rem; }
    p { color: #888; font-size: 0.9rem; margin-bottom: 1.5rem; }
    label { display: block; font-size: 0.85rem; color: #aaa; margin-bottom: 0.4rem; }
    input[type="password"] { width: 100%; padding: 0.6rem 0.8rem; background: #0f0f0f; border: 1px solid #444; border-radius: 6px; color: #e0e0e0; font-size: 1rem; margin-bottom: 1rem; outline: none; }
    input[type="password"]:focus { border-color: #a78bfa; }
    button { width: 100%; padding: 0.7rem; background: #7c3aed; border: none; border-radius: 6px; color: white; font-size: 1rem; cursor: pointer; }
    button:hover { background: #6d28d9; }
    .error { color: #f87171; font-size: 0.85rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🔮 Oracle v3</h1>
    <p>Enter your PIN to authorize access</p>
    ${errorHtml}
    <form method="POST" action="/oauth/callback">
      <input type="hidden" name="state" value="${stateKey}">
      <label for="pin">PIN</label>
      <input type="password" id="pin" name="pin" placeholder="Enter PIN" autofocus autocomplete="current-password">
      <button type="submit">Authorize</button>
    </form>
  </div>
</body>
</html>`;
  }

  /**
   * Verify PIN and issue authorization code.
   * Returns redirect URI with code param, or error info.
   */
  handleLoginCallback(
    stateKey: string,
    pin: string,
  ): { redirectUri: string } | { error: string; status: number; showLoginPage?: boolean } {
    const pending = this.pendingAuthorizations.get(stateKey);
    if (!pending) {
      return { error: 'Invalid or expired state', status: 400 };
    }

    if (Date.now() - pending.created_at > AUTH_CODE_TTL_MS) {
      this.pendingAuthorizations.delete(stateKey);
      return { error: 'Authorization request expired', status: 400 };
    }

    if (!MCP_OAUTH_PIN) {
      return { error: 'OAuth not configured', status: 503 };
    }

    // Timing-safe PIN comparison — pad to same length to satisfy timingSafeEqual requirement
    const expected = Buffer.from(MCP_OAUTH_PIN, 'utf-8');
    const provided = Buffer.from(pin || '', 'utf-8');
    const maxLen = Math.max(expected.length, provided.length);
    const expectedPadded = Buffer.concat([expected, Buffer.alloc(maxLen - expected.length)]);
    const providedPadded = Buffer.concat([provided, Buffer.alloc(maxLen - provided.length)]);

    const lengthMatch = expected.length === provided.length;
    const bytesMatch = timingSafeEqual(expectedPadded, providedPadded);
    const pinMatch = lengthMatch && bytesMatch;

    if (!pinMatch) {
      return { error: 'Incorrect PIN', status: 403, showLoginPage: true };
    }

    // Issue authorization code — one-time use
    const code = randomBytes(24).toString('hex');

    // Store code data for later token exchange
    this.issuedCodes.set(code, {
      client_id: pending.client_id,
      redirect_uri: pending.redirect_uri,
      scopes: pending.scopes,
      code_challenge: pending.code_challenge,
      resource: pending.resource,
      issued_at: Date.now(),
    });

    // Remove pending auth — it's consumed
    this.pendingAuthorizations.delete(stateKey);

    // Build redirect URI with code and original state
    const redirectUrl = new URL(pending.redirect_uri);
    redirectUrl.searchParams.set('code', code);
    if (pending.state) redirectUrl.searchParams.set('state', pending.state);

    return { redirectUri: redirectUrl.toString() };
  }

  // ─── Token exchange ──────────────────────────────────────────────────────

  exchangeAuthorizationCode(params: {
    client_id: string;
    code: string;
    code_verifier: string;
    redirect_uri: string;
  }): { access_token: string; token_type: 'bearer'; expires_in: number } | { error: string; status: number } {
    const codeData = this.issuedCodes.get(params.code);
    if (!codeData) {
      return { error: 'invalid_grant', status: 400 };
    }

    // Auth codes are one-time use — delete immediately (even on failure)
    this.issuedCodes.delete(params.code);

    // Check code expiry (5 minutes)
    if (Date.now() - codeData.issued_at > AUTH_CODE_TTL_MS) {
      return { error: 'invalid_grant: authorization code expired', status: 400 };
    }

    if (codeData.client_id !== params.client_id) {
      return { error: 'invalid_grant: client_id mismatch', status: 400 };
    }

    if (codeData.redirect_uri !== params.redirect_uri) {
      return { error: 'invalid_grant: redirect_uri mismatch', status: 400 };
    }

    // PKCE: SHA-256(code_verifier) base64url must equal stored code_challenge
    const verifierHash = createHash('sha256')
      .update(params.code_verifier)
      .digest('base64url');

    if (verifierHash !== codeData.code_challenge) {
      return { error: 'invalid_grant: PKCE verification failed', status: 400 };
    }

    const access_token = randomBytes(32).toString('hex');
    const expires_at = Date.now() + TOKEN_TTL_MS;

    this.state.tokens[access_token] = {
      client_id: codeData.client_id,
      scopes: codeData.scopes,
      expires_at,
      resource: codeData.resource,
    };
    this.saveState();

    return {
      access_token,
      token_type: 'bearer',
      expires_in: Math.floor(TOKEN_TTL_MS / 1000),
    };
  }

  // ─── Token verification ──────────────────────────────────────────────────

  /**
   * Verify an access token.
   * Checks OAuth-issued tokens first, then falls back to static MCP_AUTH_TOKEN.
   */
  verifyAccessToken(token: string): AuthInfo | null {
    if (!token) return null;

    // 1. OAuth-issued tokens
    const data = this.state.tokens[token];
    if (data) {
      if (data.expires_at < Date.now()) {
        delete this.state.tokens[token];
        this.saveState();
        return null;
      }
      return {
        token,
        client_id: data.client_id,
        scopes: data.scopes,
        expires_at: data.expires_at,
      };
    }

    // 2. Static Bearer token fallback
    if (!MCP_AUTH_TOKEN) return null;

    const expected = Buffer.from(MCP_AUTH_TOKEN, 'utf-8');
    const provided = Buffer.from(token, 'utf-8');
    const maxLen = Math.max(expected.length, provided.length);
    const expectedPadded = Buffer.concat([expected, Buffer.alloc(maxLen - expected.length)]);
    const providedPadded = Buffer.concat([provided, Buffer.alloc(maxLen - provided.length)]);

    const match = timingSafeEqual(expectedPadded, providedPadded) && expected.length === provided.length;
    if (!match) return null;

    return {
      token,
      client_id: 'static-bearer',
      scopes: ['read', 'write'],
      expires_at: Infinity,
    };
  }

  // ─── Token revocation ────────────────────────────────────────────────────

  revokeToken(token: string): void {
    if (this.state.tokens[token]) {
      delete this.state.tokens[token];
      this.saveState();
    }
  }

  // ─── Accessors for testing ───────────────────────────────────────────────

  getTokenCount(): number {
    return Object.keys(this.state.tokens).length;
  }

  getClientCount(): number {
    return Object.keys(this.state.clients).length;
  }
}

// Singleton instance
let _provider: OAuthProvider | null = null;

export function getOAuthProvider(): OAuthProvider {
  if (!_provider) {
    _provider = new OAuthProvider();
  }
  return _provider;
}

/** Reset singleton (for testing) */
export function resetOAuthProvider(): void {
  _provider = null;
}
