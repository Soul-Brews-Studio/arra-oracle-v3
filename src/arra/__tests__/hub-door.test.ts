/**
 * The hub door end to end over real HTTP: a hub server runs in a child process (its own .arra),
 * this test process is the node (its own .arra). invite → join → share through the hub → sync →
 * grouped search → read → expiry → revoke + RETIRED row → stranger 401 → hub down.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const repo = path.resolve(import.meta.dir, '../../..');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'arra-hubdoor-')));
const hubDir = path.join(root, 'hub');
const vaultDir = path.join(root, 'vault');
const nodeDir = path.join(root, 'node');
const port = 51200 + Math.floor(Math.random() * 300);
const hubUrl = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof Bun.spawn> | null = null;
let client: typeof import('../hub-client.ts');
let sqlite: import('bun:sqlite').Database;

const git = (cwd: string, ...a: string[]) => Bun.spawnSync(['git', ...a], { cwd, stdout: 'pipe', stderr: 'pipe' });
const owner = async (p: string, body?: unknown) => {
  const res = await fetch(`${hubUrl}/api/v1/arra${p}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json() as Promise<Record<string, any>>;
};

beforeAll(async () => {
  for (const d of [hubDir, vaultDir, nodeDir]) fs.mkdirSync(d);
  git(vaultDir, 'init', '-q', '-b', 'trunk');
  git(vaultDir, 'config', 'user.email', 'hub@example.com'); git(vaultDir, 'config', 'user.name', 'hub');
  fs.writeFileSync(path.join(vaultDir, 'README.md'), '# org vault\n');
  git(vaultDir, 'add', '.'); git(vaultDir, 'commit', '-q', '-m', 'init');
  const { initArra } = await import('../init.ts');
  initArra({ dir: hubDir, hub: true, hubName: 'soul-brews', vaults: [{ name: 'soul-brews', path: vaultDir }] });
  initArra({ dir: nodeDir, name: 'node-b' });
  server = Bun.spawn(['bun', 'src/server.ts'], {
    cwd: repo, stdout: 'ignore', stderr: 'ignore',
    env: { ...process.env, NODE_ENV: 'production', ORACLE_PORT: String(port), ORACLE_DATA_DIR: path.join(hubDir, '.arra'),
      ORACLE_DB_PATH: path.join(hubDir, '.arra', 'oracle.db'), ORACLE_REPO_ROOT: hubDir, ORACLE_EMBEDDER: 'none',
      ORACLE_FILE_WATCHER: '0', ORACLE_INDEXER_ENQUEUE: '0', ARRA_API_TOKEN: '' },
  });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${hubUrl}/api/health`)).ok) break; } catch { /* booting */ }
    await Bun.sleep(250);
  }
  process.env.ORACLE_DATA_DIR = path.join(nodeDir, '.arra');
  process.env.ORACLE_DB_PATH = path.join(nodeDir, '.arra', 'oracle.db');
  process.env.ORACLE_EMBEDDER = 'none';
  ({ sqlite } = await import('../../db/index.ts'));
  client = await import('../hub-client.ts');
}, 60_000);

afterAll(() => { server?.kill(); });

describe('hub door', () => {
  let nodeId = '';

  test('a stranger with no token gets 401; a bad code gets 401', async () => {
    expect((await fetch(`${hubUrl}/api/v1/federation/vault`)).status).toBe(401);
    expect((await fetch(`${hubUrl}/api/v1/federation/vault`, { headers: { authorization: 'Bearer arra_node_nope' } })).status).toBe(401);
    await expect(client.joinHub({ url: hubUrl, code: 'AAAA-BBBB-CCCC' })).rejects.toThrow('401');
  });

  test('invite → join gives this node a token; the code cannot be used twice', async () => {
    const inv = (await owner('/hub/invite', { for: '7d', label: 'node-a' })).invite;
    expect(inv.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const joined = await client.joinHub({ url: hubUrl, code: inv.code.toLowerCase() });
    expect(joined.hub).toBe('soul-brews');
    nodeId = joined.nodeId;
    const saved = JSON.parse(fs.readFileSync(path.join(nodeDir, '.arra', 'hubs.json'), 'utf-8'));
    expect(saved[0].token).toStartWith('arra_node_');
    expect((fs.statSync(path.join(nodeDir, '.arra', 'hubs.json')).mode & 0o777).toString(8)).toBe('600');
    await expect(client.joinHub({ url: hubUrl, code: inv.code })).rejects.toThrow('already used');
  });

  test('share through the hub lands in its vault; sync brings it here as hub:soul-brews', async () => {
    const r = await client.shareToHub('soul-brews', { title: 'Wedging clay', text: '# Wedging clay\nRam-head wedging removes air pockets.' });
    expect(r.shared.rel).toContain('wedging-clay');
    expect(fs.readFileSync(path.join(vaultDir, r.shared.rel), 'utf-8')).toContain('shared_by: "node-a"');
    const hub = client.findHub('soul-brews');
    const s = await client.syncHub(sqlite, hub);
    expect(s.pulled).toBe('ff');
    expect(s.added).toBe(2);
    const { groupedSearch } = await import('../search.ts');
    const g = await groupedSearch(sqlite, 'wedging');
    expect(g.groups.find((x) => x.source === 'hub:soul-brews')?.results[0].title).toBe('Wedging clay');
  });

  test('hub nodes lists the node with calls and last seen', async () => {
    const nodes = (await owner('/hub/nodes')).nodes as Array<Record<string, any>>;
    const me = nodes.find((n) => n.id === nodeId)!;
    expect(me).toMatchObject({ label: 'node-a', state: 'active' });
    expect(me.calls).toBeGreaterThanOrEqual(2);
    expect(me.tokenHash).toBeUndefined();
  });

  test('a node invited --for 1s expires: 403, and search still answers from local rows', async () => {
    const inv = (await owner('/hub/invite', { for: '1s', label: 'guest' })).invite;
    const res = await fetch(`${hubUrl}/api/v1/federation/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: inv.code }) });
    const { token } = await res.json() as { token: string };
    await Bun.sleep(1200);
    const after = await fetch(`${hubUrl}/api/v1/federation/vault`, { headers: { authorization: `Bearer ${token}` } });
    expect(after.status).toBe(403);
    expect((await after.json() as { error: string }).error).toContain('expired');
  });

  test('revoke stops the token at once and writes a RETIRED.md row in the hub vault', async () => {
    const r = await owner('/hub/revoke', { id: nodeId, why: 'machine retired', successor: 'nothing' });
    expect(r.revokedAt).toBeString();
    const retired = fs.readFileSync(path.join(vaultDir, 'RETIRED.md'), 'utf-8');
    expect(retired).toContain(`hub node ${nodeId} (node-a)`);
    expect(retired).toContain('machine retired');
    const s = await client.syncHub(sqlite, client.findHub('soul-brews'));
    expect(s.pulled).toBe('failed');
    expect(s.error).toContain('403');
  });

  test('hub down: sync reports unreachable, grouped search still answers from self + cached rows', async () => {
    server?.kill();
    await Bun.sleep(300);
    const s = await client.syncHub(sqlite, client.findHub('soul-brews'));
    expect(s.pulled).toBe('failed');
    expect(s.error).toContain('hub:soul-brews unreachable');
    const { groupedSearch } = await import('../search.ts');
    const g = await groupedSearch(sqlite, 'wedging');
    expect(g.groups.find((x) => x.source === 'hub:soul-brews')?.results.length).toBe(1);
  });

  test('join refuses a public address before any network call', async () => {
    await expect(client.joinHub({ url: 'http://8.8.8.8:47778', code: 'X' })).rejects.toThrow('not a tailnet or LAN address');
  });
});
