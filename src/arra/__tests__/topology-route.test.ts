/**
 * GET /api/arra/topology: owner only; vault, hub, nodes by state, door refusals, Ossie status.
 * The door log is fed by the real /api/federation routes: a stranger (401), a revoked node (403),
 * a caller from a public address (403).
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PEER_IP_HEADER } from '../net.ts';
import { hashSecret } from '../tokens.ts';

type App = { handle(r: Request): Promise<Response> };
let arra: App;
let door: App;
const now = Date.now();
const iso = (ms: number) => new Date(now + ms).toISOString();
const node = (id: string, extra: Record<string, unknown>) => ({
  id, label: id.split('-')[0] + '-' + id.split('-')[1], url: null, tokenHash: hashSecret(`tok-${id}`), joinedAt: iso(-3600_000),
  expiresAt: iso(3600_000), lastSeenAt: iso(-60_000), lastIp: '100.64.1.2', calls: 4, status: 'active', ...extra,
});

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-topology-'));
  const vault = path.join(dir, 'vault');
  fs.mkdirSync(vault);
  const git = (...a: string[]) => Bun.spawnSync(['git', ...a], { cwd: vault });
  git('init', '-q'); git('config', 'user.email', 'h@example.com'); git('config', 'user.name', 'h');
  fs.writeFileSync(path.join(vault, 'README.md'), '# org\n'); git('add', '.'); git('commit', '-q', '-m', 'init');
  fs.writeFileSync(path.join(dir, 'arra.json'), JSON.stringify({ version: 1, name: 'hub', createdAt: 'x', vaults: [{ name: 'soul-brews', path: vault }], hub: { name: 'soul-brews' } }));
  fs.writeFileSync(path.join(dir, 'hub-state.json'), JSON.stringify({ invites: [], nodes: [
    node('node-a-0001', { status: 'revoked', revokedAt: iso(-1000), revokeReason: 'test' }),
    node('node-b-0002', {}),
    node('guest-x-0003', { expiresAt: iso(-1000) }),
  ] }));
  process.env.ORACLE_DATA_DIR = dir;
  process.env.ORACLE_DB_PATH = path.join(dir, 'oracle.db');
  ({ arraRoutes: arra } = await import('../../routes/arra/index.ts'));
  ({ hubRoutes: door } = await import('../../routes/hub/index.ts'));
  (await import('../door-log.ts')).resetDoorLog();
}, 60_000);

const req = (app: App, url: string, ip: string, headers: Record<string, string> = {}) =>
  app.handle(new Request(`http://127.0.0.1:47944${url}`, { headers: { [PEER_IP_HEADER]: ip, ...headers } }));
const topo = async () => (await req(arra, '/api/arra/topology', '127.0.0.1')).json() as Promise<Record<string, any>>;

describe('GET /api/arra/topology', () => {
  test('vault, hub and every node with its state', async () => {
    const t = await topo();
    expect(t.ok).toBe(true);
    expect(t.viewer).toBe('owner');
    expect(t.hub).toMatchObject({ name: 'soul-brews', port: 47944 });
    expect(t.truth.name).toBe('soul-brews');
    expect(t.truth.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(t.privateNote).toContain('never sent to the hub');
    expect(Object.fromEntries(t.nodes.map((n: any) => [n.id, n.state]))).toEqual({ 'node-a-0001': 'revoked', 'node-b-0002': 'active', 'guest-x-0003': 'expired' });
    for (const n of t.nodes) expect(n.tokenHash).toBeUndefined();
    expect(t.ossie.check.ok).toBe(true);
    expect(t.door.strangers.count).toBe(0);
  });
  test('door refusals show up: stranger 401, revoked node 403, public address 403', async () => {
    expect((await req(door, '/api/federation/vault', '100.64.9.9')).status).toBe(401);
    expect((await req(door, '/api/federation/vault', '100.64.9.9', { authorization: 'Bearer nope' })).status).toBe(401);
    expect((await req(door, '/api/federation/vault', '100.64.1.2', { authorization: 'Bearer tok-node-a-0001' })).status).toBe(403);
    expect((await req(door, '/api/federation/hub', '8.8.8.8')).status).toBe(403);
    const t = await topo();
    expect(t.door.strangers.count).toBe(2);
    expect(t.door.outside.count).toBe(1);
    expect(t.nodes.find((n: any) => n.id === 'node-a-0001').refused.count).toBe(1);
    expect(t.nodes.find((n: any) => n.id === 'node-b-0002').refused.count).toBe(0);
  });
  test('reading the topology never counts as a node call', async () => {
    const before = (await topo()).nodes.find((n: any) => n.id === 'node-b-0002').calls;
    expect((await topo()).nodes.find((n: any) => n.id === 'node-b-0002').calls).toBe(before);
  });
  test('a tailnet peer gets 403', async () => {
    expect((await req(arra, '/api/arra/topology', '100.64.0.9')).status).toBe(403);
  });
});
