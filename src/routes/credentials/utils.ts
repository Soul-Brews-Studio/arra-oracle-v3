import { createHmac, timingSafeEqual } from 'crypto';

export interface TokenPayload {
  agent: string;
  scope: string;
  expires_at: string;
  exp: number; // expiration epoch in seconds
}

function base64urlEncode(str: string): string {
  return Buffer.from(str).toString('base64url');
}

function base64urlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString('utf8');
}

export function generateToken(agent: string, scope: string, secret: string): { token: string; expires_at: string } {
  const expiresAtMs = Date.now() + 15 * 60 * 1000; // 15-minute TTL
  const expires_at = new Date(expiresAtMs).toISOString();

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload: TokenPayload = {
    agent,
    scope,
    expires_at,
    exp: Math.floor(expiresAtMs / 1000),
  };

  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(payload));

  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret)
    .update(signatureInput)
    .digest('base64url');

  return {
    token: `${signatureInput}.${signature}`,
    expires_at,
  };
}

export function verifyToken(token: string, secret: string): { valid: boolean; agent?: string; scope?: string; expires_at?: string } {
  if (!token) {
    return { valid: false };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false };
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const expectedSignature = createHmac('sha256', secret)
    .update(signatureInput)
    .digest('base64url');

  const sigBuf = Buffer.from(signature, 'base64url');
  const expectedBuf = Buffer.from(expectedSignature, 'base64url');
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false };
  }

  try {
    const payloadStr = base64urlDecode(encodedPayload);
    const payload = JSON.parse(payloadStr) as TokenPayload;

    if (typeof payload.agent !== 'string' || typeof payload.scope !== 'string' || typeof payload.exp !== 'number') {
      return { valid: false };
    }

    if (Date.now() >= payload.exp * 1000) {
      return { valid: false };
    }

    return {
      valid: true,
      agent: payload.agent,
      scope: payload.scope,
      expires_at: payload.expires_at,
    };
  } catch {
    return { valid: false };
  }
}
