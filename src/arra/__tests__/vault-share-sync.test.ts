/**
 * share → git vault → sync on another clone → rows as `hub:<name>`. Real git, temp repos only.
 * One node (this test's DB) shares into its clone; the "other node" is simulated by a second
 * clone that is synced through the same index code.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vault-')));
const bare = path.join(root, 'org-vault.git');
const cloneA = path.join(root, 'vault-a');
const cloneB = path.join(root, 'vault-b');
const node = path.join(root, 'node-a');
const run = (cwd: string, ...args: string[]) => {
  const p = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${p.stderr}`);
  return p.stdout.toString().trim();
};

let api: { handle(r: Request): Promise<Response> };
let sqlite: import('bun:sqlite').Database;
let vault: typeof import('../vault.ts');

beforeAll(async () => {
  run(root, 'init', '-q', '--bare', '-b', 'main', bare);
  run(root, 'clone', '-q', bare, cloneA);
  for (const c of [cloneA]) { run(c, 'config', 'user.email', 't@example.com'); run(c, 'config', 'user.name', 't'); }
  fs.writeFileSync(path.join(cloneA, 'README.md'), '# org vault\n');
  run(cloneA, 'add', '.'); run(cloneA, 'commit', '-q', '-m', 'init'); run(cloneA, 'push', '-q', '-u', 'origin', 'main');
  run(root, 'clone', '-q', bare, cloneB);
  fs.mkdirSync(node);
  const { initArra } = await import('../init.ts');
  initArra({ dir: node, name: 'node-a', vaults: [{ name: 'soul-brews', path: cloneA }] });
  process.env.ORACLE_DATA_DIR = path.join(node, '.arra');
  process.env.ORACLE_DB_PATH = path.join(node, '.arra', 'oracle.db');
  process.env.ORACLE_EMBEDDER = 'none';
  ({ sqlite } = await import('../../db/index.ts'));
  ({ arraRoutes: api } = await import('../../routes/arra/index.ts'));
  vault = await import('../vault.ts');
}, 60_000);

const post = async (p: string, body: unknown) => {
  const res = await api.handle(new Request(`http://local/api/arra${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() as Record<string, any> };
};

describe('arra share', () => {
  test('writes the note as .md into the vault, commits and pushes', async () => {
    const r = await post('/share', { text: '# Kiln schedule\nBisque at 1000C, glaze at 1240C.', vault: 'soul-brews' });
    expect(r.status).toBe(200);
    expect(r.body.shared.rel).toMatch(/^ψ\/memory\/shared\/\d{4}-\d{2}-\d{2}_kiln-schedule\.md$/);
    expect(r.body.shared.pushed).toBe(true);
    const md = fs.readFileSync(path.join(cloneA, r.body.shared.rel), 'utf-8');
    expect(md).toContain('shared_by: "node-a"');
    expect(md).toContain('Bisque at 1000C');
    expect(run(bare, 'log', '--oneline', '-1')).toContain('share: Kiln schedule');
  });

  test('sharing the same note twice does not make a second commit', async () => {
    const before = run(cloneA, 'rev-list', '--count', 'HEAD');
    const r = await post('/share', { text: '# Kiln schedule\nBisque at 1000C, glaze at 1240C.', vault: 'soul-brews' });
    // same title + same day + same text → existing file, no commit
    expect(r.body.shared.created).toBe(false);
    expect(run(cloneA, 'rev-list', '--count', 'HEAD')).toBe(before);
  });

  test('unknown vault and empty input are clear errors', async () => {
    expect((await post('/share', { text: 'x', vault: 'nope' })).body.error).toContain('no vault named "nope"');
    expect((await post('/share', { vault: 'soul-brews' })).body.error).toContain('needs a document id, a file, or text');
  });
});

describe('arra sync', () => {
  test('the other clone pulls and indexes the shared note as hub:<name>', () => {
    const report = vault.syncVault(sqlite, { name: 'soul-brews', path: cloneB });
    expect(report.pulled).toBe('ff');
    expect(report.vault).toBe('hub:soul-brews');
    expect(report.added).toBe(2); // README.md + the shared note
    const row = sqlite.query("SELECT origin, created_by, type FROM oracle_documents WHERE id LIKE 'hub:soul-brews:ψ/memory/shared/%'").get() as Record<string, string>;
    expect(row).toEqual({ origin: 'hub:soul-brews', created_by: 'node-a', type: 'learning' });
    const fts = sqlite.query("SELECT id FROM oracle_fts WHERE oracle_fts MATCH 'glaze'").all() as Array<{ id: string }>;
    expect(fts.map((r) => r.id).some((id) => id.startsWith('hub:soul-brews:'))).toBe(true);
  });

  test('second sync: nothing changed; an edited file updates; a removed file is superseded, not deleted', () => {
    expect(vault.syncVault(sqlite, { name: 'soul-brews', path: cloneB }).unchanged).toBe(2);
    fs.writeFileSync(path.join(cloneA, 'README.md'), '# org vault\nrules: no secrets\n');
    run(cloneA, 'commit', '-qam', 'edit readme'); run(cloneA, 'push', '-q');
    expect(vault.syncVault(sqlite, { name: 'soul-brews', path: cloneB }).updated).toBe(1);
    run(cloneA, 'rm', '-q', 'README.md'); run(cloneA, 'commit', '-qm', 'move readme'); run(cloneA, 'push', '-q');
    const r = vault.syncVault(sqlite, { name: 'soul-brews', path: cloneB });
    expect(r.removed).toBe(1);
    const gone = sqlite.query("SELECT superseded_by FROM oracle_documents WHERE id = 'hub:soul-brews:README.md'").get();
    expect(gone).toEqual({ superseded_by: '_vault_removed' });
  });

  test('POST /api/arra/sync indexes every connected vault', async () => {
    const r = await post('/sync', {});
    expect(r.status).toBe(200);
    expect(r.body.vaults.map((v: { vault: string }) => v.vault)).toEqual(['hub:soul-brews']);
  });
});
