import { createHash, timingSafeEqual } from 'node:crypto';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

export const MCP_HTTP_AUTH_SCOPE = 'mcp:streamable-http';
type Env = Record<string, string | undefined>;
type AuthResult = { ok: true; authInfo: AuthInfo } | { ok: false; response: Response };

type ExpressRequestShim = { headers: { authorization?: string }; auth?: AuthInfo };

class ExpressResponseShim {
  readonly headers = new Headers();
  statusCode = 200;
  body: unknown = null;

  set(field: string | Record<string, string>, value?: string) {
    if (typeof field === 'string') this.headers.set(field, value ?? '');
    else for (const [key, next] of Object.entries(field)) this.headers.set(key, next);
    return this;
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(body: unknown) {
    this.body = body;
    return this;
  }

  toResponse() {
    return Response.json(this.body ?? { error: 'invalid_token' }, {
      status: this.statusCode || 401,
      headers: this.headers,
    });
  }
}

export function configuredMcpHttpToken(env: Env = process.env): string | null {
  return env.ORACLE_MCP_HTTP_TOKEN?.trim() || env.ARRA_API_TOKEN?.trim() || null;
}

export function createStaticMcpBearerVerifier(env: Env = process.env): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const configured = configuredMcpHttpToken(env);
      if (!configured) throw new InvalidTokenError('MCP HTTP bearer token is not configured');
      if (!constantTimeTokenEquals(token, configured)) throw new InvalidTokenError('Invalid bearer token');
      return {
        token,
        clientId: 'arra-oracle-mcp-http',
        scopes: [MCP_HTTP_AUTH_SCOPE],
        expiresAt: Math.floor(Date.now() / 1000) + 315360000,
      };
    },
  };
}

export async function requireMcpBearerAuth(request: Request, env: Env = process.env): Promise<AuthResult> {
  const req: ExpressRequestShim = { headers: { authorization: request.headers.get('authorization') ?? undefined } };
  const res = new ExpressResponseShim();
  const middleware = requireBearerAuth({ verifier: createStaticMcpBearerVerifier(env), requiredScopes: [MCP_HTTP_AUTH_SCOPE] });
  await middleware(req as any, res as any, () => undefined);
  return req.auth ? { ok: true, authInfo: req.auth } : { ok: false, response: res.toResponse() };
}

function constantTimeTokenEquals(actual: string, expected: string): boolean {
  const actualDigest = createHash('sha256').update(actual).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}
