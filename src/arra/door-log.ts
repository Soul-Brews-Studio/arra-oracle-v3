/**
 * Who knocked on the hub door and was turned away, since this server started (#3110 topology).
 *
 * In memory on purpose: it is a live gauge for the Topology view, not an audit log, and a stranger
 * hammering the door must not turn into disk writes. Counts reset on restart; `since` says when.
 *
 *   strangers  401: no token, an unknown token, or a bad invite code
 *   outside    403: a caller from a public address (the door is tailnet/LAN only)
 *   refused    403 per node: a revoked or expired node still calling
 */

export interface Knock { count: number; lastAt: string | null }

const empty = (): Knock => ({ count: 0, lastAt: null });
let log = { since: new Date().toISOString(), strangers: empty(), outside: empty(), refused: {} as Record<string, Knock> };

function bump(k: Knock, now: Date) { k.count += 1; k.lastAt = now.toISOString(); }

export function recordKnock(kind: 'stranger' | 'outside' | 'refused', nodeId?: string, now = new Date()) {
  if (kind === 'stranger') bump(log.strangers, now);
  else if (kind === 'outside') bump(log.outside, now);
  else if (nodeId) bump(log.refused[nodeId] ??= empty(), now);
}

export function doorLog() {
  return { since: log.since, strangers: { ...log.strangers }, outside: { ...log.outside }, refused: structuredClone(log.refused) };
}

/** Tests only. */
export function resetDoorLog(now = new Date()) {
  log = { since: now.toISOString(), strangers: empty(), outside: empty(), refused: {} };
}
