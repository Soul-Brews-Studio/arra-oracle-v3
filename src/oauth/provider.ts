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
 * - IP-based rate limiting for PIN brute-force protection
 */

import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { writeFileSync, readFileSync, renameSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';

import { MCP_OAUTH_PIN, MCP_EXTERNAL_URL, ORACLE_DATA_DIR, MCP_AUTH_TOKEN } from '../config.ts';
import type { OAuthState, OAuthClientInfo, PendingAuthorization } from './types.ts';

export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const AUTH_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Far-future sentinel used for static Bearer tokens (avoids Infinity, which is not JSON-serializable)
const STATIC_TOKEN_EXPIRES_AT = new Date('2100-01-01T00:00:00Z').getTime();

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

/** Rate-limit window for a single IP */
interface RateLimitRecord {
  count: number;
  resetAt: number;
}

/** Escape user-supplied strings for safe HTML interpolation */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export class OAuthProvider {
  private readonly stateFile: string;
  private state: OAuthState;
  // stateKey → pending auth (before PIN verification)
  private pendingAuthorizations: Map<string, PendingAuthorization> = new Map();
  // code → issued code data (after PIN verification, before token exchange)
  private issuedCodes: Map<string, IssuedCode> = new Map();

  // Rate limiting: ip → {count, resetAt}
  private pinAttempts: Map<string, RateLimitRecord> = new Map();

  private static readonly MAX_PIN_ATTEMPTS = 10;
  private static readonly PIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
  private static readonly MAX_PENDING_AUTHORIZATIONS = 100;

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
    } catch (err) {
      console.error('[OAuth] Failed to parse state file, starting with empty state:', err);
      return { clients: {}, tokens: {} };
    }
  }

  /** Atomic write: write to temp file then rename — crash-safe. Sets 0600 permissions. */
  private saveState(): void {
    try {
      const dir = dirname(this.stateFile);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const tmp = join(tmpdir(), `.oauth-state-${Date.now()}-${randomBytes(4).toString('hex')}.tmp`);
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf-8');
      chmodSync(tmp, 0o600);
      renameSync(tmp, this.stateFile);
    } catch (err) {
      console.error('[OAuth] saveState failed — token state may be inconsistent:', err);
    }
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

    // Clean expired rate-limit windows
    for (const [ip, record] of this.pinAttempts.entries()) {
      if (now > record.resetAt) {
        this.pinAttempts.delete(ip);
      }
    }
  }

  // ─── Rate limiting ───────────────────────────────────────────────────────

  private checkRateLimit(ip: string): { allowed: boolean; attemptsLeft: number } {
    const now = Date.now();
    const record = this.pinAttempts.get(ip);

    if (!record || now > record.resetAt) {
      return { allowed: true, attemptsLeft: OAuthProvider.MAX_PIN_ATTEMPTS };
    }

    const attemptsLeft = OAuthProvider.MAX_PIN_ATTEMPTS - record.count;
    return { allowed: attemptsLeft > 0, attemptsLeft };
  }

  private recordFailedAttempt(ip: string): number {
    const now = Date.now();
    const record = this.pinAttempts.get(ip);

    if (!record || now > record.resetAt) {
      this.pinAttempts.set(ip, { count: 1, resetAt: now + OAuthProvider.PIN_LOCKOUT_MS });
      return OAuthProvider.MAX_PIN_ATTEMPTS - 1;
    }

    record.count++;
    return Math.max(0, OAuthProvider.MAX_PIN_ATTEMPTS - record.count);
  }

  private resetAttempts(ip: string): void {
    this.pinAttempts.delete(ip);
  }

  // ─── Registration auth ───────────────────────────────────────────────────

  /**
   * Verify that a client registration request is authorized.
   * Requires Bearer MCP_AUTH_TOKEN if configured.
   * Returns true if registration is allowed.
   */
  checkRegistrationAuth(authHeader: string): boolean {
    if (!MCP_AUTH_TOKEN) {
      // No token configured — allow (degraded mode, log warning)
      console.warn('[OAuth] /register: MCP_AUTH_TOKEN not set — registration is unprotected');
      return true;
    }
    const providedToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const expected = Buffer.from(MCP_AUTH_TOKEN, 'utf-8');
    const provided = Buffer.from(providedToken, 'utf-8');
    const maxLen = Math.max(expected.length, provided.length);
    return (
      expected.length === provided.length &&
      timingSafeEqual(
        Buffer.concat([expected, Buffer.alloc(maxLen - expected.length)]),
        Buffer.concat([provided, Buffer.alloc(maxLen - provided.length)]),
      )
    );
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

    console.log(`[OAuth] Client registered: ${client_id} (${metadata.client_name ?? 'unnamed'})`);
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

    // Clean stale entries before enforcing the cap
    this.cleanExpiredTokens();

    if (this.pendingAuthorizations.size >= OAuthProvider.MAX_PENDING_AUTHORIZATIONS) {
      console.warn('[OAuth] /authorize rejected: too many pending authorizations');
      return { error: 'Too many pending authorizations — try again later' };
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

    console.log(`[OAuth] Authorization started for client: ${params.client_id}`);
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
      ? `<p class="error">${escapeHtml(errorMessage)}</p>`
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
      <input type="hidden" name="state" value="${escapeHtml(stateKey)}">
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
   * @param ip - Client IP address for rate limiting (pass 'unknown' if unavailable)
   */
  handleLoginCallback(
    stateKey: string,
    pin: string,
    ip: string = 'unknown',
  ): { redirectUri: string } | { error: string; status: number; showLoginPage?: boolean } {
    // Rate limit check
    const rateCheck = this.checkRateLimit(ip);
    if (!rateCheck.allowed) {
      console.warn(`[OAuth] PIN rate limit exceeded for IP: ${ip}`);
      return { error: 'Too many failed attempts. Please try again in 15 minutes.', status: 429, showLoginPage: true };
    }

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
      const attemptsLeft = this.recordFailedAttempt(ip);
      console.warn(`[OAuth] Failed PIN attempt from IP: ${ip}, attempts remaining: ${attemptsLeft}`);
      const msg = attemptsLeft > 0
        ? `Incorrect PIN (${attemptsLeft} attempts remaining)`
        : 'Incorrect PIN — account locked for 15 minutes';
      return { error: msg, status: 403, showLoginPage: true };
    }

    this.resetAttempts(ip);

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

    console.log(`[OAuth] PIN verified, auth code issued for client: ${pending.client_id}`);

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
      console.warn(`[OAuth] PKCE verification failed for client: ${params.client_id}`);
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

    console.log(`[OAuth] Access token issued for client: ${codeData.client_id}`);

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
      token: '[redacted]',
      client_id: 'static-bearer',
      scopes: ['read', 'write'],
      expires_at: STATIC_TOKEN_EXPIRES_AT,
    };
  }

  // ─── Token revocation ────────────────────────────────────────────────────

  revokeToken(token: string): void {
    if (this.state.tokens[token]) {
      delete this.state.tokens[token];
      this.saveState();
      console.log('[OAuth] Token revoked');
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
