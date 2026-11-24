/**
 * Who is calling: the peer address of an HTTP request, and whether it is private.
 *
 * The hub door is open only to tailnet and LAN addresses (issue #3110). The server binds
 * 0.0.0.0, so the check has to be made per request, from the socket address — never from a
 * header a client could set. `startServer` stamps the socket address into PEER_IP_HEADER on
 * every request, overwriting whatever the client sent.
 */

export const PEER_IP_HEADER = 'x-arra-peer-ip';

function ipv4Parts(ip: string): number[] | null {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const parts = v4.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}

/** 127.0.0.0/8 and ::1. */
export function isLoopback(ip: string | null | undefined): boolean {
  if (!ip) return false;
  if (ip === '::1') return true;
  const v4 = ipv4Parts(ip);
  return !!v4 && v4[0] === 127;
}

/**
 * Loopback, RFC 1918 LAN, tailscale CGNAT (100.64.0.0/10) and the tailscale IPv6 ULA range
 * (fd7a:115c:a1e0::/48). Everything else, including other link-local and public addresses,
 * is refused.
 */
export function isPrivateIp(ip: string | null | undefined): boolean {
  if (!ip) return false;
  if (isLoopback(ip)) return true;
  const v4 = ipv4Parts(ip);
  if (v4) {
    const [a, b] = v4;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  return ip.toLowerCase().startsWith('fd7a:115c:a1e0:');
}

/** The socket address stamped by the server; null when the request did not come through it. */
export function peerIp(request: Request): string | null {
  return request.headers.get(PEER_IP_HEADER)?.trim() || null;
}

/**
 * Set the peer header on `request` to the real socket address, overwriting any client value.
 * Mutates in place on purpose: wrapping it in `new Request(request, init)` made Bun hang on
 * POST bodies (found by the oracle_learn proxy test). Falls back to a copy if headers are frozen.
 */
export function stampPeerIp(request: Request, address: string | null | undefined): Request {
  try {
    request.headers.set(PEER_IP_HEADER, address ?? '');
    return request;
  } catch {
    const headers = new Headers(request.headers);
    headers.set(PEER_IP_HEADER, address ?? '');
    return new Request(request, { headers });
  }
}
