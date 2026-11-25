/**
 * The small JSON files an arra data dir keeps next to oracle.db.
 *
 *   arra.json       this node: name, connected vaults, hub mode (written by `arra init`)
 *   hubs.json       hubs this node joined: url + node token (secret, mode 0600)
 *   hub-state.json  only on a hub: invite code hashes and joined nodes (token hashes only)
 *
 * JSON instead of new tables on purpose: the DB is a rebuildable cache of the vault, and these
 * files are configuration. Deleting `.arra/oracle.db` must not forget which hubs you joined.
 */

import fs from 'fs';
import path from 'path';

export interface VaultRef {
  /** label used in sources: `hub:<name>` */
  name: string;
  /** local git checkout of the vault */
  path: string;
}

export interface ArraConfig {
  version: 1;
  name: string;
  createdAt: string;
  vaults: VaultRef[];
  hub?: { name: string; vault?: string };
}

export interface JoinedHub {
  name: string;
  url: string;
  nodeId: string;
  token: string;
  joinedAt: string;
  expiresAt: string | null;
  lastSyncAt?: string;
  lastSyncSha?: string;
}

export interface HubInvite {
  codeHash: string;
  label: string;
  /** how long the joined node stays valid, e.g. "15m"; "forever" = no expiry */
  grant: string;
  createdAt: string;
  /** the code itself is good for 10 minutes */
  codeExpiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
}

export interface HubNode {
  id: string;
  label: string;
  url: string | null;
  tokenHash: string;
  joinedAt: string;
  expiresAt: string | null;
  lastSeenAt: string | null;
  lastIp: string | null;
  calls: number;
  status: 'active' | 'revoked';
  revokedAt?: string;
  revokeReason?: string;
}

export interface HubState {
  invites: HubInvite[];
  nodes: HubNode[];
}

export function dataDir(): string {
  const env = process.env.ORACLE_DATA_DIR?.trim();
  if (env) return path.resolve(env);
  const home = process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || '.';
  return path.join(home, '.arra-oracle-v2');
}

export const statePath = (file: string, dir = dataDir()) => path.join(dir, file);

export function readJson<T>(file: string, fallback: T, dir = dataDir()): T {
  try {
    return JSON.parse(fs.readFileSync(statePath(file, dir), 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

/** Write via a temp file and rename, so a crash never leaves half a JSON file. */
export function writeJson(file: string, value: unknown, dir = dataDir(), mode = 0o644): void {
  fs.mkdirSync(dir, { recursive: true });
  const target = statePath(file, dir);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode });
  fs.renameSync(tmp, target);
  fs.chmodSync(target, mode);
}

export function readConfig(dir = dataDir()): ArraConfig | null {
  return readJson<ArraConfig | null>('arra.json', null, dir);
}

export function writeConfig(config: ArraConfig, dir = dataDir()): void {
  writeJson('arra.json', config, dir);
}

export function readHubs(dir = dataDir()): JoinedHub[] {
  return readJson<JoinedHub[]>('hubs.json', [], dir);
}

export function writeHubs(hubs: JoinedHub[], dir = dataDir()): void {
  writeJson('hubs.json', hubs, dir, 0o600);
}

export function readHubState(dir = dataDir()): HubState {
  return readJson<HubState>('hub-state.json', { invites: [], nodes: [] }, dir);
}

export function writeHubState(state: HubState, dir = dataDir()): void {
  writeJson('hub-state.json', state, dir, 0o600);
}

/** Hub token with the secret cut out, for anything that prints or returns hubs. */
export function publicHub(hub: JoinedHub) {
  const { token: _token, ...rest } = hub;
  return { ...rest, expired: isExpired(hub.expiresAt) };
}

export function isExpired(expiresAt: string | null | undefined, now = new Date()): boolean {
  return !!expiresAt && Date.parse(expiresAt) <= now.getTime();
}
