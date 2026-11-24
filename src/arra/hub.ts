/**
 * Hub side of the door: invite codes, node tokens, node list, revoke.
 *
 *   invite  one-use code, good for 10 minutes; the node it admits lasts `--for` (15m|1h|7d|forever)
 *   join    code → per-node token. The hub keeps only sha256 hashes of codes and tokens.
 *   auth    every remote call: private address (checked by the route) + a live token
 *   revoke  token stops working at once; a RETIRED.md row records it. Nothing is deleted.
 */

import { randomBytes } from 'crypto';
import { isExpired, readConfig, readHubState, writeHubState, type HubNode } from './state.ts';
import { expiryFrom, hashInviteCode, hashSecret, newInviteCode, newNodeToken, parseDuration, sameHash, timeLeft } from './tokens.ts';
import { retire } from './retire.ts';

const CODE_TTL_MS = 10 * 60_000;

export function hubName(): string {
  const hub = readConfig()?.hub;
  if (!hub) throw new Error('this arra is not a hub: arra init --hub --name <name> [dir]');
  return hub.name;
}

export function createInvite(input: { grant?: string; label?: string }, now = new Date()) {
  const name = hubName();
  const grant = (input.grant ?? '1h').trim().toLowerCase();
  parseDuration(grant);
  const label = input.label?.trim() || 'node';
  const code = newInviteCode();
  const state = readHubState();
  const codeExpiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();
  state.invites.push({ codeHash: hashInviteCode(code), label, grant, createdAt: now.toISOString(), codeExpiresAt, usedAt: null, usedBy: null });
  writeHubState(state);
  return { hub: name, code, label, grant, codeExpiresAt };
}

export class HubAuthError extends Error {
  constructor(readonly status: 401 | 403, message: string) { super(message); }
}

export function redeemInvite(input: { code: string; label?: string; url?: string }, ip: string | null, now = new Date()) {
  const name = hubName();
  const state = readHubState();
  const hash = hashInviteCode(input.code ?? '');
  const invite = state.invites.find((i) => sameHash(i.codeHash, hash));
  if (!invite) throw new HubAuthError(401, 'unknown invite code');
  if (invite.usedAt) throw new HubAuthError(401, 'invite code already used');
  if (isExpired(invite.codeExpiresAt, now)) throw new HubAuthError(401, 'invite code expired (codes last 10 minutes)');
  const label = (input.label?.trim() || invite.label).slice(0, 64);
  const id = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'node'}-${randomBytes(2).toString('hex')}`;
  const token = newNodeToken();
  const node: HubNode = {
    id, label, url: input.url?.trim() || null, tokenHash: hashSecret(token), joinedAt: now.toISOString(),
    expiresAt: expiryFrom(invite.grant, now), lastSeenAt: now.toISOString(), lastIp: ip, calls: 0, status: 'active',
  };
  invite.usedAt = now.toISOString();
  invite.usedBy = id;
  state.nodes.push(node);
  writeHubState(state);
  return { hub: name, nodeId: id, token, expiresAt: node.expiresAt, grant: invite.grant };
}

/** The node behind `token`, after counting the call; throws HubAuthError (401/403) otherwise. */
export function authenticateNode(token: string | null, ip: string | null, now = new Date()): HubNode {
  if (!token) throw new HubAuthError(401, 'node token required: arra join <hub url> --code <code>');
  const state = readHubState();
  const hash = hashSecret(token);
  const node = state.nodes.find((n) => sameHash(n.tokenHash, hash));
  if (!node) throw new HubAuthError(401, 'unknown node token');
  if (node.status === 'revoked') throw new HubAuthError(403, `node ${node.id} was revoked`);
  if (isExpired(node.expiresAt, now)) throw new HubAuthError(403, `node ${node.id} expired at ${node.expiresAt}: ask for a new invite`);
  node.lastSeenAt = now.toISOString();
  node.lastIp = ip;
  node.calls += 1;
  writeHubState(state);
  return node;
}

export function listNodes(now = new Date()) {
  return readHubState().nodes.map(({ tokenHash: _hash, ...n }) => ({
    ...n,
    state: n.status === 'revoked' ? 'revoked' : isExpired(n.expiresAt, now) ? 'expired' : 'active',
    left: n.status === 'revoked' ? '-' : timeLeft(n.expiresAt, now),
  }));
}

export function listInvites(now = new Date()) {
  return readHubState().invites.map(({ codeHash: _hash, ...i }) => ({
    ...i, state: i.usedAt ? 'used' : isExpired(i.codeExpiresAt, now) ? 'expired' : 'open',
  }));
}

export function revokeNode(id: string, input: { why?: string; successor?: string } = {}, now = new Date()) {
  const state = readHubState();
  const node = state.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`no node ${id} (arra hub nodes lists them)`);
  if (node.status === 'revoked') return { node: id, alreadyRevoked: true };
  node.status = 'revoked';
  node.revokedAt = now.toISOString();
  node.revokeReason = input.why?.trim() || 'revoked by hub owner';
  writeHubState(state);
  const retired = retire({
    thing: `hub node ${id} (${node.label})`,
    why: node.revokeReason,
    successor: input.successor?.trim() || 'nothing',
    back: `arra hub invite --label ${node.label}, then arra join on that machine`,
    by: hubName(),
  });
  return { node: id, revokedAt: node.revokedAt, retired };
}
