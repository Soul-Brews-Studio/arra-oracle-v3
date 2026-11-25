/**
 * `arra init [dir]`: creates `<dir>/.arra/` with the latest schema and ψ indexed, wires
 * .gitignore + .envrc in a git repo, prints export lines outside one, and is idempotent.
 * Runs the real indexer child process (FTS-only), against temp folders only.
 */
import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initArra } from '../init.ts';

const roots: string[] = [];
function tempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.push(dir);
  return dir;
}
afterAll(() => { for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true }); });

function gitRepoWithNote(): string {
  const dir = tempDir('arra-init-repo-');
  Bun.spawnSync(['git', 'init', '-q', dir]);
  const learn = path.join(dir, 'ψ', 'memory', 'learnings');
  fs.mkdirSync(learn, { recursive: true });
  fs.writeFileSync(path.join(learn, '2026-11-25_tailnet-hub.md'), '---\ntitle: tailnet hub\n---\n# Tailnet hub\nJoin the hub with a one-use invite code.\n');
  return dir;
}

describe('arra init', () => {
  test('in a git repo: .arra with schema + indexed ψ, .gitignore and .envrc written', () => {
    const dir = gitRepoWithNote();
    const r = initArra({ dir, name: 'alpha-node' });
    expect(r.created).toBe(true);
    expect(r.dataDir).toBe(path.join(dir, '.arra'));
    expect(r.gitRepo).toBe(dir);
    expect(r.indexed.ok).toBe(true);
    expect(r.gitignore).toBe('added');
    expect(r.envrc).toBe('written');
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8')).toContain('.arra/');
    const envrc = fs.readFileSync(path.join(dir, '.envrc'), 'utf-8');
    expect(envrc).toContain(`ORACLE_DATA_DIR="${dir}/.arra"`);
    expect(envrc).toContain(`ORACLE_REPO_ROOT="${dir}"`);
    const db = new Database(path.join(dir, '.arra', 'oracle.db'), { readonly: true });
    const docs = db.query('SELECT source_file FROM oracle_documents').all() as Array<{ source_file: string }>;
    db.close();
    expect(docs.map((d) => d.source_file)).toContain('ψ/memory/learnings/2026-11-25_tailnet-hub.md');
    const config = JSON.parse(fs.readFileSync(path.join(dir, '.arra', 'arra.json'), 'utf-8'));
    expect(config.name).toBe('alpha-node');
  }, 60_000);

  test('second run checks and reports, keeps the index, does not duplicate .gitignore lines', () => {
    const dir = gitRepoWithNote();
    initArra({ dir });
    const again = initArra({ dir });
    expect(again.created).toBe(false);
    expect(again.indexed.ran).toBe(false);
    expect(again.gitignore).toBe('present');
    expect(again.envrc).toBe('present');
    const lines = fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8').split('\n').filter((l) => l === '.arra/');
    expect(lines.length).toBe(1);
  }, 60_000);

  test('outside a git repo: empty schema, nothing written beside .arra, export lines printed', () => {
    const dir = tempDir('arra-init-plain-');
    const r = initArra({ dir, hub: true, hubName: 'soul-brews' });
    expect(r.gitRepo).toBeNull();
    expect(r.gitignore).toBe('skipped');
    expect(fs.existsSync(path.join(dir, '.envrc'))).toBe(false);
    expect(r.exportLines).toEqual([`export ORACLE_DATA_DIR="${dir}/.arra"`, `export ORACLE_REPO_ROOT="${dir}"`]);
    expect(r.indexed.ok).toBe(true);
    expect(r.config.hub?.name).toBe('soul-brews');
    expect(fs.existsSync(path.join(dir, '.arra', 'oracle.db'))).toBe(true);
  }, 60_000);

  test('--from copies this folder\'s rows out of an older DB, read-only', () => {
    const old = gitRepoWithNote();
    initArra({ dir: old });
    const dir = tempDir('arra-init-from-');
    // the old DB holds a row whose source file lives under the new folder
    const oldDb = new Database(path.join(old, '.arra', 'oracle.db'));
    const now = Date.now();
    oldDb.query(`INSERT INTO oracle_documents (id, type, source_file, concepts, created_at, updated_at, indexed_at)
      VALUES ('learning_moved', 'learning', ?, '[]', ?, ?, ?)`).run(`${dir}/ψ/memory/learnings/moved.md`, now, now, now);
    oldDb.query(`INSERT INTO oracle_fts (id, content, concepts) VALUES ('learning_moved', 'moved note body', '')`).run();
    oldDb.close();
    const r = initArra({ dir, from: path.join(old, '.arra') });
    expect(r.copiedFrom?.rows).toBe(1);
    const fresh = new Database(path.join(dir, '.arra', 'oracle.db'), { readonly: true });
    expect(fresh.query("SELECT count(*) AS n FROM oracle_documents WHERE id = 'learning_moved'").get()).toEqual({ n: 1 });
    fresh.close();
    expect(initArra({ dir, from: path.join(old, '.arra') }).copiedFrom?.rows).toBe(0);
  }, 60_000);
});
