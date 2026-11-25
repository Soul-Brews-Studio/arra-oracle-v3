/**
 * Manual snapshots: refused with private rows, created on a vault-only arra, pushed to a folder,
 * pulled on another node only when model + vault sha match. Old vectors are moved aside.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'arra-snap-')));
const vaultDir = path.join(root, 'vault');
const hubDir = path.join(root, 'hub');
const nodeDir = path.join(root, 'node');
const shelf = path.join(root, 'shelf');
const git = (cwd: string, ...args: string[]) => Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' }).stdout.toString().trim();

let sqlite: import('bun:sqlite').Database;
let snap: typeof import('../snapshot.ts');

beforeAll(async () => {
  fs.mkdirSync(vaultDir); fs.mkdirSync(hubDir); fs.mkdirSync(nodeDir);
  git(vaultDir, 'init', '-q', '-b', 'main');
  git(vaultDir, 'config', 'user.email', 't@example.com'); git(vaultDir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(vaultDir, 'note.md'), '# shared\n');
  git(vaultDir, 'add', '.'); git(vaultDir, 'commit', '-q', '-m', 'one');
  const { initArra } = await import('../init.ts');
  initArra({ dir: hubDir, hub: true, hubName: 'soul-brews', vaults: [{ name: 'soul-brews', path: vaultDir }] });
  initArra({ dir: nodeDir, vaults: [{ name: 'soul-brews', path: vaultDir }] });
  process.env.ORACLE_DATA_DIR = path.join(hubDir, '.arra');
  process.env.ORACLE_DB_PATH = path.join(hubDir, '.arra', 'oracle.db');
  process.env.ORACLE_EMBEDDER = 'none';
  ({ sqlite } = await import('../../db/index.ts'));
  snap = await import('../snapshot.ts');
  // a stand-in vector store on the hub
  fs.mkdirSync(path.join(hubDir, '.arra', 'lancedb', 'oracle.lance'), { recursive: true });
  fs.writeFileSync(path.join(hubDir, '.arra', 'lancedb', 'oracle.lance', 'data.bin'), 'vectors-v1');
}, 60_000);

describe('arra snapshot', () => {
  test('create names the archive by model + vault sha and packs the vector store', () => {
    const m = snap.createSnapshot(sqlite);
    const sha = git(vaultDir, 'rev-parse', 'HEAD');
    expect(m.file).toBe(`lancedb-none-${sha.slice(0, 12)}.tar.zst`);
    expect(m.parts).toEqual(['lancedb']);
    expect(fs.existsSync(path.join(hubDir, '.arra', 'snapshots', m.file))).toBe(true);
    expect(snap.readManifest(path.join(hubDir, '.arra', 'snapshots', m.file)).sha).toBe(sha);
  });

  test('refused while the arra holds private documents', () => {
    const now = Date.now();
    sqlite.query(`INSERT INTO oracle_documents (id, type, source_file, concepts, created_at, updated_at, indexed_at)
      VALUES ('private-1', 'learning', 'ψ/x.md', '[]', ?, ?, ?)`).run(now, now, now);
    expect(() => snap.createSnapshot(sqlite)).toThrow('holds 1 private documents');
    sqlite.query("DELETE FROM oracle_documents WHERE id = 'private-1'").run();
  });

  test('push to a folder, pull on another node with the same key; old vectors moved aside', () => {
    const pushed = snap.pushSnapshotToDir(shelf);
    expect(fs.existsSync(pushed.to)).toBe(true);
    const nodeData = path.join(nodeDir, '.arra');
    fs.mkdirSync(path.join(nodeData, 'lancedb'), { recursive: true });
    fs.writeFileSync(path.join(nodeData, 'lancedb', 'old.bin'), 'old');
    const r = snap.pullSnapshotFromDir(shelf, nodeData);
    expect(r.matched).toBe(true);
    expect(r.restored).toEqual(['lancedb']);
    expect(fs.readFileSync(path.join(nodeData, 'lancedb', 'oracle.lance', 'data.bin'), 'utf-8')).toBe('vectors-v1');
    expect(r.movedAside?.[0]).toMatch(/^lancedb\.prev-/);
    expect(fs.existsSync(path.join(nodeData, r.movedAside![0], 'old.bin'))).toBe(true);
  });

  test('a node at a different vault commit is refused and told to sync', () => {
    fs.writeFileSync(path.join(vaultDir, 'two.md'), '# two\n');
    git(vaultDir, 'add', '.'); git(vaultDir, 'commit', '-q', '-m', 'two');
    const r = snap.pullSnapshotFromDir(shelf, path.join(nodeDir, '.arra'));
    expect(r.matched).toBe(false);
    expect(r.reason).toContain('run arra sync');
  });
});
