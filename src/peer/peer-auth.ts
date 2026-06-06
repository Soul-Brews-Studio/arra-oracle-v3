import { timingSafeEqual } from 'crypto';

export function peerToken() { return process.env.ARRA_PEER_TOKEN?.trim() || ''; }
export function isPeerAuthEnabled() { return peerToken().length > 0; }
function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a); const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
export function isPeerAuthorized(request: Request) {
  const configured = peerToken();
  if (!configured) return true;
  const auth = request.headers.get('authorization') ?? '';
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const urlToken = new URL(request.url).searchParams.get('token')?.trim();
  return Boolean((bearer && safeEqual(bearer, configured)) || (urlToken && safeEqual(urlToken, configured)));
}
export function unauthorizedPeerResponse() { return { error: 'peer_auth_required', message: 'ARRA peer token required' }; }
