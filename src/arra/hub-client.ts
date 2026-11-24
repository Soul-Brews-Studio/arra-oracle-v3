/**
 * Node side of the door: join a hub with a code, then share / sync / read / snapshot through it.
 * Every call carries the node token; a hub that is down or refuses is reported, never fatal to
 * local work (self search keeps answering).
 */

import type { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { isPrivateIp } from './net.ts';
import { dataDir, readConfig, readHubs, writeHubs, type JoinedHub } from './state.ts';
import { indexVaultFiles, type VaultFile } from './vault-index.ts';
import { snapshotDir, snapshotName, currentKey, applySnapshot, type PullResult } from './snapshot.ts';

const TIMEOUT_MS = Number(process.env.ARRA_HUB_TIMEOUT_MS ?? 4000);

export function normalizeHubUrl(raw: string): string {
  const url = new URL(raw.includes('://') ? raw : `http://${raw}`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('hub url must be http(s)');
  if (!url.port && url.protocol === 'http:') url.port = '47778';
  return `${url.protocol}//${url.host}`;
}

/** Tailnet / LAN only: a `*.ts.net` name, `localhost`, or a private literal address. */
export function assertPrivateHost(url: string): void {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.ts.net') || host.endsWith('.local') || isPrivateIp(host)) return;
  throw new Error(`refused: ${host} is not a tailnet or LAN address (use the *.ts.net name or a 100.x / 192.168.x / 10.x address)`);
}

export async function hubFetch(hub: Pick<JoinedHub, 'url' | 'token'> | { url: string; token?: string }, p: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if ('token' in hub && hub.token) headers.set('authorization', `Bearer ${hub.token}`);
  return fetch(`${hub.url}/api/v1/federation${p}`, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(`hub said ${res.status}: ${body.error ?? res.statusText}`);
  return body;
}

export function findHub(name?: string): JoinedHub {
  const hubs = readHubs();
  const clean = name?.replace(/^hub:/, '');
  const hub = clean ? hubs.find((h) => h.name === clean) : hubs.length === 1 ? hubs[0] : undefined;
  if (!hub) throw new Error(clean ? `not joined to hub "${clean}"` : hubs.length ? 'several hubs joined: name one' : 'no hub joined: arra join <url> --code <code>');
  return hub;
}

export async function joinHub(input: { url: string; code: string; label?: string }) {
  const url = normalizeHubUrl(input.url);
  assertPrivateHost(url);
  // the invite's label names the node unless the joiner asks for another one
  const label = input.label?.trim() || undefined;
  const r = await json<{ hub: string; nodeId: string; token: string; expiresAt: string | null; grant: string }>(
    await hubFetch({ url }, '/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: input.code, label }) }),
  );
  const hub: JoinedHub = { name: r.hub, url, nodeId: r.nodeId, token: r.token, joinedAt: new Date().toISOString(), expiresAt: r.expiresAt };
  writeHubs([...readHubs().filter((h) => h.name !== hub.name), hub]);
  return { hub: r.hub, url, nodeId: r.nodeId, expiresAt: r.expiresAt, grant: r.grant };
}

export function leaveHub(name: string) {
  const hub = findHub(name);
  writeHubs(readHubs().filter((h) => h.name !== hub.name));
  return { left: hub.name, note: 'token dropped locally; rows already synced stay as a cache (hub keeps its copy)' };
}

function touchHub(name: string, patch: Partial<JoinedHub>): void {
  writeHubs(readHubs().map((h) => (h.name === name ? { ...h, ...patch } : h)));
}

export async function syncHub(sqlite: Database, hub: JoinedHub, models?: Record<string, { collection: string }>) {
  try {
    const r = await json<{ name: string; sha: string | null; files: VaultFile[] }>(await hubFetch(hub, '/vault'));
    const report = indexVaultFiles(sqlite, hub.name, r.files, { models });
    touchHub(hub.name, { lastSyncAt: new Date().toISOString(), lastSyncSha: r.sha ?? undefined });
    return { vault: `hub:${hub.name}`, sha: r.sha, pulled: 'ff' as const, ...report };
  } catch (error) {
    const message = error instanceof Error ? (error.name === 'TimeoutError' ? `hub:${hub.name} unreachable` : error.message) : String(error);
    return { vault: `hub:${hub.name}`, sha: hub.lastSyncSha ?? null, pulled: 'failed' as const, error: message, files: 0, added: 0, updated: 0, unchanged: 0, removed: 0, queued: 0 };
  }
}

export async function shareToHub(name: string, note: { title: string; text: string; concepts?: string[] }) {
  const hub = findHub(name);
  return json<{ shared: { vault: string; rel: string; sha: string | null; pushed: boolean; created: boolean } }>(
    await hubFetch(hub, '/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(note) }),
  );
}

export async function readFromHub(name: string, id: string) {
  return json<Record<string, unknown>>(await hubFetch(findHub(name), `/doc/${encodeURIComponent(id)}`));
}

export async function pushSnapshotToHub(name: string, file?: string, dir = dataDir()) {
  const hub = findHub(name);
  const pick = file ?? fs.readdirSync(snapshotDir(dir)).filter((f) => f.endsWith('.tar.zst')).sort().pop();
  if (!pick) throw new Error('no snapshot to push: arra snapshot create first');
  const bytes = fs.readFileSync(path.join(snapshotDir(dir), pick));
  await json(await hubFetch(hub, `/snapshots/${encodeURIComponent(pick)}`, { method: 'PUT', body: bytes }));
  return { file: pick, hub: `hub:${hub.name}`, bytes: bytes.length };
}

export async function pullSnapshotFromHub(name: string, dir = dataDir()): Promise<PullResult> {
  const hub = findHub(name);
  const wanted = snapshotName(currentKey(dir, hub.name));
  const res = await hubFetch(hub, `/snapshots/${encodeURIComponent(wanted)}`);
  if (res.status === 404) return { matched: false, wanted, reason: `hub:${hub.name} has no ${wanted}: run arra sync (embeds the diff)` };
  if (!res.ok) throw new Error(`hub said ${res.status}`);
  fs.mkdirSync(snapshotDir(dir), { recursive: true });
  const local = path.join(snapshotDir(dir), wanted);
  fs.writeFileSync(local, new Uint8Array(await res.arrayBuffer()));
  return applySnapshot(local, dir, hub.name);
}
