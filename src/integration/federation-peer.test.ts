import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const ROOT = process.cwd();
let serverProc: Bun.Subprocess | undefined;
let mockPeer: ReturnType<typeof Bun.serve> | undefined;
let base = '';
let peerPubkey = 'a'.repeat(64);
async function waitFor(url: string, timeoutMs = 15000) { const start = Date.now(); while (Date.now() - start < timeoutMs) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 200)); } throw new Error(`Timed out waiting for ${url}`); }
async function json(path: string, init?: RequestInit) { const res = await fetch(`${base}${path}`, init); const body = await res.json().catch(() => ({})); return { res, body }; }

describe('federation peer stack', () => {
  beforeAll(async () => {
    mockPeer = Bun.serve({ port: 0, fetch(req) { const url = new URL(req.url); if (url.pathname === '/info') return Response.json({ maw: { schema: '1', capabilities: ['feed', 'arra-search'] }, node: 'mawjs@test', oracle: 'mawjs', locators: [`http://127.0.0.1:${mockPeer!.port}`], ts: Date.now() }); if (url.pathname === '/api/identity') return Response.json({ pubkey: peerPubkey, node: 'mawjs@test', oracle: 'mawjs' }); return Response.json({ error: 'not found' }, { status: 404 }); }});
    const dataDir = mkdtempSync(join(tmpdir(), 'arra-fed-data-'));
    const repoRoot = mkdtempSync(join(tmpdir(), 'arra-fed-repo-'));
    mkdirSync(join(repoRoot, 'ψ'), { recursive: true });
    writeFileSync(join(repoRoot, 'ψ', 'federation.md'), '# Federation Note\n\nmawjs peer search regression sentinel.\n');
    const port = 49000 + Math.floor(Math.random() * 1000); base = `http://127.0.0.1:${port}`;
    serverProc = Bun.spawn(['bun', 'src/server.ts'], { cwd: ROOT, stdout: 'ignore', stderr: 'ignore', env: { ...process.env, ORACLE_PORT: String(port), ORACLE_DATA_DIR: dataDir, ORACLE_DB_PATH: join(dataDir, 'oracle.db'), ORACLE_REPO_ROOT: repoRoot, ARRA_NAMED_PEERS: JSON.stringify({ mawjs: `http://127.0.0.1:${mockPeer.port}` }), ARRA_PEER_TOKEN: 'secret', VECTOR_URL: '', MAW_JS_URL: 'http://127.0.0.1:1' } });
    await waitFor(`${base}/api/health`);
  });
  afterAll(() => { serverProc?.kill(); mockPeer?.stop(true); });
  test('serves discovery and stable identity while protected endpoints require token', async () => { const info = await json('/info'); expect(info.res.status).toBe(200); expect(info.body.maw.schema).toBe('1'); expect(info.body.maw.capabilities).toContain('feed'); expect(info.body.maw.capabilities).toContain('arra-search'); const id1 = await json('/api/identity'); const id2 = await json('/api/identity'); expect(id1.body.pubkey).toMatch(/^[0-9a-f]{64}$/); expect(id2.body.pubkey).toBe(id1.body.pubkey); const localFeed = await json('/api/feed'); expect(localFeed.body.error).not.toBe('peer_auth_required'); expect((await json('/api/peer/feed')).res.status).toBe(401); expect((await json('/api/peer/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'mawjs' }) })).res.status).toBe(401); });
  test('pins peers with TOFU and reports mismatches', async () => { const first = await json('/api/peers'); expect(first.body.peers[0].ok).toBe(true); expect(first.body.peers[0].pinStatus).toBe('new'); const second = await json('/api/peers'); expect(second.body.peers[0].pinStatus).toBe('pinned'); peerPubkey = 'b'.repeat(64); const mismatch = await json('/api/peers'); expect(mismatch.body.peers[0].ok).toBe(false); expect(mismatch.body.peers[0].error).toBe('MISMATCH'); });
  test('serves authenticated feed and peer search with bounded results', async () => { const feed = await json('/api/peer/feed?token=secret&limit=500'); expect(feed.res.status).toBe(200); expect(feed.body.items.length).toBeGreaterThan(0); expect(feed.body.items.length).toBeLessThanOrEqual(100); const search = await json('/api/peer/search', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer secret' }, body: JSON.stringify({ query: 'mawjs', limit: 5 }) }); expect(search.res.status).toBe(200); expect(search.body.results.length).toBeGreaterThan(0); expect(search.body.results[0].snippet.toLowerCase()).toContain('mawjs'); });
});
