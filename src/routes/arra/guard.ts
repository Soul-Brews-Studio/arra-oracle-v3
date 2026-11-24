/**
 * Who may call what.
 *
 *   /api/arra/*        the box owner only: loopback callers (the CLI, the MCP server, skills
 *                      on this machine). A tailnet peer gets 403 — it is not its arra.
 *   /api/federation/*  hub door: private address (tailnet/LAN) AND a live node token.
 *
 * A request with no stamped peer address never came through the real socket (an in-process
 * test calling `app.handle`); it is treated as local.
 */

import { isLoopback, isPrivateIp, peerIp } from '../../arra/net.ts';

export function isOwnerRequest(request: Request): boolean {
  const ip = peerIp(request);
  return ip === null || isLoopback(ip);
}

export function isPrivateRequest(request: Request): boolean {
  const ip = peerIp(request);
  return ip === null || isPrivateIp(ip);
}

export function bearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') ?? '';
  return auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;
}

export function denied(set: { status?: unknown }, status: 401 | 403, error: string) {
  set.status = status;
  return { ok: false, error };
}

export function failed(set: { status?: unknown }, error: unknown, status = 400) {
  set.status = status;
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}
