/**
 * OAuth 2.1 Integration Tests
 *
 * Tests the full OAuth flow against a live server.
 * Run with: MCP_AUTH_TOKEN=test-token MCP_OAUTH_PIN=1234 bun test src/integration/oauth.test.ts
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import type { Subprocess } from 'bun';
import { createHash, randomBytes } from 'crypto';

const BASE_URL = 'http://localhost:47779'; // Use distinct port to avoid conflict with existing server
const TEST_TOKEN = 'test-bearer-token';
const TEST_PIN = '1234';

let serverProcess: Subprocess | null = null;

// ─── PKCE helpers ────────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

async function waitForServer(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return true;
    } catch {
      // Not ready yet
    }
    await Bun.sleep(500);
  }
  return false;
}

describe('OAuth 2.1 Integration', () => {
  beforeAll(async () => {
    serverProcess = Bun.spawn(['bun', 'run', 'src/server.ts'], {
      cwd: import.meta.dir.replace('/src/integration', ''),
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        ORACLE_PORT: '47779',
        MCP_AUTH_TOKEN: TEST_TOKEN,
        MCP_OAUTH_PIN: TEST_PIN,
        MCP_EXTERNAL_URL: BASE_URL,
        ORACLE_CHROMA_TIMEOUT: '1000',
      },
    });

    const ready = await waitForServer();
    if (!ready) {
      let stderr = '';
      if (serverProcess.stderr) {
        const reader = serverProcess.stderr.getReader();
        try {
          const { value } = await reader.read();
          if (value) stderr = new TextDecoder().decode(value);
        } catch { /* ignore */ }
      }
      throw new Error(`OAuth test server failed to start.\nStderr: ${stderr}`);
    }
  }, 30_000);

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  // ─── Discovery metadata ──────────────────────────────────────────────────

  describe('OAuth discovery endpoints', () => {
    test('GET /.well-known/oauth-authorization-server returns metadata', async () => {
      const res = await fetch(`${BASE_URL}/.well-known/oauth-authorization-server`);
      expect(res.status).toBe(200);
      const data = await res.json() as Record<string, unknown>;
      expect(data.issuer).toBe(BASE_URL);
      expect(data.authorization_endpoint).toBe(`${BASE_URL}/authorize`);
      expect(data.token_endpoint).toBe(`${BASE_URL}/token`);
      expect(data.registration_endpoint).toBe(`${BASE_URL}/register`);
      expect(Array.isArray(data.code_challenge_methods_supported)).toBe(true);
      expect((data.code_challenge_methods_supported as string[]).includes('S256')).toBe(true);
    });

    test('GET /.well-known/oauth-protected-resource returns resource metadata', async () => {
      const res = await fetch(`${BASE_URL}/.well-known/oauth-protected-resource`);
      expect(res.status).toBe(200);
      const data = await res.json() as Record<string, unknown>;
      expect(data.resource).toBe(BASE_URL);
      expect(Array.isArray(data.authorization_servers)).toBe(true);
    });
  });

  // ─── Client registration ─────────────────────────────────────────────────

  describe('Dynamic client registration', () => {
    test('POST /register returns client_id and client_secret', async () => {
      const res = await fetch(`${BASE_URL}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TEST_TOKEN}`,
        },
        body: JSON.stringify({
          redirect_uris: ['http://localhost:9999/callback'],
          client_name: 'Test Client',
          grant_types: ['authorization_code'],
          response_types: ['code'],
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json() as Record<string, unknown>;
      expect(typeof data.client_id).toBe('string');
      expect(typeof data.client_secret).toBe('string');
      expect(data.redirect_uris).toEqual(['http://localhost:9999/callback']);
    });

    test('POST /register without Bearer token returns 401', async () => {
      const res = await fetch(`${BASE_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirect_uris: ['http://localhost:9999/callback'] }),
      });
      expect(res.status).toBe(401);
    });

    test('POST /register without redirect_uris returns 400', async () => {
      const res = await fetch(`${BASE_URL}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TEST_TOKEN}`,
        },
        body: JSON.stringify({ client_name: 'Bad Client' }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── Full OAuth flow ─────────────────────────────────────────────────────

  describe('Full OAuth authorization flow', () => {
    let clientId: string;
    let clientSecret: string;
    const redirectUri = 'http://localhost:9999/callback';
    let oauthToken: string;

    test('Step 1: Register client', async () => {
      const res = await fetch(`${BASE_URL}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TEST_TOKEN}`,
        },
        body: JSON.stringify({
          redirect_uris: [redirectUri],
          client_name: 'Flow Test Client',
          grant_types: ['authorization_code'],
          response_types: ['code'],
        }),
      });
      const data = await res.json() as Record<string, string>;
      clientId = data.client_id;
      clientSecret = data.client_secret;
      expect(clientId).toBeTruthy();
    });

    test('Step 2: GET /authorize redirects to /oauth/login', async () => {
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);

      const authorizeUrl = new URL(`${BASE_URL}/authorize`);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');
      authorizeUrl.searchParams.set('scope', 'read write');
      authorizeUrl.searchParams.set('state', 'test-state-123');

      const res = await fetch(authorizeUrl.toString(), { redirect: 'manual' });
      expect(res.status).toBe(302);
      const location = res.headers.get('location') || '';
      expect(location).toContain('/oauth/login?state=');
    });

    test('Step 3: GET /oauth/login returns HTML with PIN form', async () => {
      // Need to go through authorize to get state key
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);

      const authorizeUrl = new URL(`${BASE_URL}/authorize`);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');

      const redirectRes = await fetch(authorizeUrl.toString(), { redirect: 'manual' });
      const loginUrl = redirectRes.headers.get('location') || '';

      const loginRes = await fetch(loginUrl);
      expect(loginRes.status).toBe(200);
      const html = await loginRes.text();
      expect(html).toContain('Oracle v3');
      expect(html).toContain('/oauth/callback');
    });

    test('Step 4: POST /oauth/callback with wrong PIN returns 403', async () => {
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);

      const authorizeUrl = new URL(`${BASE_URL}/authorize`);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');

      const redirectRes = await fetch(authorizeUrl.toString(), { redirect: 'manual' });
      const loginUrl = redirectRes.headers.get('location') || '';
      const stateKey = new URL(loginUrl).searchParams.get('state') || '';

      const callbackRes = await fetch(`${BASE_URL}/oauth/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ state: stateKey, pin: 'wrongpin' }).toString(),
        redirect: 'manual',
      });
      expect(callbackRes.status).toBe(403);
    });

    test('Step 5: Full flow — authorize → PIN → code → token → use /mcp', async () => {
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);
      const flowState = 'flow-state-xyz';

      // Authorize
      const authorizeUrl = new URL(`${BASE_URL}/authorize`);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');
      authorizeUrl.searchParams.set('state', flowState);

      const redirectRes = await fetch(authorizeUrl.toString(), { redirect: 'manual' });
      expect(redirectRes.status).toBe(302);
      const loginUrl = redirectRes.headers.get('location') || '';
      const stateKey = new URL(loginUrl).searchParams.get('state') || '';

      // Submit correct PIN
      const callbackRes = await fetch(`${BASE_URL}/oauth/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ state: stateKey, pin: TEST_PIN }).toString(),
        redirect: 'manual',
      });
      expect(callbackRes.status).toBe(302);
      const codeRedirect = callbackRes.headers.get('location') || '';
      expect(codeRedirect).toContain('code=');

      const codeUrl = new URL(codeRedirect);
      const code = codeUrl.searchParams.get('code') || '';
      const returnedState = codeUrl.searchParams.get('state');
      expect(code).toBeTruthy();
      expect(returnedState).toBe(flowState);

      // Exchange code for token
      const tokenRes = await fetch(`${BASE_URL}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
        }).toString(),
      });
      expect(tokenRes.status).toBe(200);
      const tokenData = await tokenRes.json() as Record<string, unknown>;
      expect(typeof tokenData.access_token).toBe('string');
      expect(tokenData.token_type).toBe('bearer');
      oauthToken = tokenData.access_token as string;

      // Use token on /mcp (Streamable HTTP requires Accept header per MCP spec)
      const mcpRes = await fetch(`${BASE_URL}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': `Bearer ${oauthToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'oauth-test', version: '1.0' },
          },
        }),
      });
      expect(mcpRes.status).toBe(200);
    });

    test('Step 6: POST /revoke invalidates token', async () => {
      if (!oauthToken) return; // Skip if previous test didn't run

      const revokeRes = await fetch(`${BASE_URL}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: oauthToken }).toString(),
      });
      expect(revokeRes.status).toBe(200);

      // Token should now be rejected
      const mcpRes = await fetch(`${BASE_URL}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': `Bearer ${oauthToken}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });
      expect(mcpRes.status).toBe(401);
    });
  });

  // ─── Static Bearer fallback ──────────────────────────────────────────────

  describe('Static Bearer token fallback', () => {
    test('POST /mcp with static Bearer token still works when OAuth enabled', async () => {
      const res = await fetch(`${BASE_URL}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': `Bearer ${TEST_TOKEN}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'fallback-test', version: '1.0' },
          },
        }),
      });
      expect(res.status).toBe(200);
    });

    test('POST /mcp without token returns 401 with WWW-Authenticate header', async () => {
      const res = await fetch(`${BASE_URL}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });
      expect(res.status).toBe(401);
      const wwwAuth = res.headers.get('WWW-Authenticate') || '';
      expect(wwwAuth).toContain('Bearer');
      expect(wwwAuth).toContain('oauth-protected-resource');
    });
  });

  // ─── /token endpoint edge cases ──────────────────────────────────────────

  describe('/token endpoint edge cases', () => {
    test('POST /token with unknown code returns 400', async () => {
      const res = await fetch(`${BASE_URL}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: 'nonexistent-code',
          client_id: 'fake-client',
          code_verifier: 'fakeverifier',
          redirect_uri: 'http://localhost:9999/callback',
        }).toString(),
      });
      expect(res.status).toBe(400);
    });

    test('POST /token with unsupported grant_type returns 400', async () => {
      const res = await fetch(`${BASE_URL}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: 'fake-client',
        }).toString(),
      });
      expect(res.status).toBe(400);
    });
  });
});
