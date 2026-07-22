import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { eq, sql } from 'drizzle-orm';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dateSlug } from '../../../src/learn/markdown.ts';
import { slugFor } from '../../../src/routes/learn/content.ts';

const saved = Object.fromEntries(['ORACLE_DATA_DIR', 'ORACLE_DB_PATH', 'ORACLE_REPO_ROOT', 'GHQ_ROOT']
  .map((key) => [key, process.env[key]]));
const root = join(tmpdir(), `arra-http-learn-authority-${Date.now()}`);
const dataDir = join(root, 'data');
const repoRoot = join(root, 'server', 'github.com', 'soul-brews-studio', 'arra-oracle-v3');
const ghqRoot = join(root, 'ghq');
const vaultRoot = join(ghqRoot, 'github.com', 'test', 'oracle-vault');
mkdirSync(repoRoot, { recursive: true });
mkdirSync(vaultRoot, { recursive: true });
mkdirSync(join(vaultRoot, '.git'));
process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = join(dataDir, 'oracle.db');
process.env.ORACLE_REPO_ROOT = repoRoot;
process.env.GHQ_ROOT = ghqRoot;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
dbMod.setSetting('vault_repo', 'github.com/test/oracle-vault');
mock.module('../../../src/vault/discovery.ts', () => ({ getVaultPsiRoot: () => ({ path: vaultRoot }) }));
const { createLearnCrudRoutes } = await import('../../../src/routes/learn/index.ts');

function app() { return new Elysia({ prefix: '/api' }).use(createLearnCrudRoutes()); }
async function call(method: string, path: string, body?: unknown) {
  const res = await app().handle(new Request(`http://local${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() as Record<string, any> };
}
function count(table: string): number {
  return Number((dbMod.sqlite.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n);
}
function effects() {
  return ['oracle_documents', 'oracle_fts', 'learn_log', 'oracle_entity_links', 'indexing_jobs']
    .map((table) => count(table))
    .concat(Array.from(new Bun.Glob('**/*.md').scanSync(vaultRoot)).length);
}

beforeEach(() => {
  for (const table of ['oracle_entity_links', 'indexing_jobs', 'learn_log', 'oracle_fts', 'oracle_documents']) {
    dbMod.sqlite.run(`DELETE FROM ${table}`);
  }
  for (const dir of ['github.com', '_universal']) rmSync(join(vaultRoot, dir), { recursive: true, force: true });
});

afterAll(() => {
  dbMod.resetDefaultDatabaseForTests(':memory:');
  for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;
  rmSync(root, { recursive: true, force: true });
});

describe('actual HTTP learn route project authority', () => {
  test('explicit project drives path, DB, log, and frontmatter identically', async () => {
    const project = 'github.com/acme/widgets';
    const result = await call('POST', '/api/learn', { pattern: 'HTTP project-first placement', project });
    expect(result.status).toBe(200);
    const expected = join(vaultRoot, project, 'ψ/memory/learnings', result.body.file.split('/').at(-1));
    expect(existsSync(expected)).toBe(true);
    expect(result.body.file).toStartWith(`${project}/ψ/memory/learnings/`);
    const row = dbMod.db.select().from(dbMod.oracleDocuments).where(eq(dbMod.oracleDocuments.id, result.body.id)).get();
    const log = dbMod.db.select().from(dbMod.learnLog).where(eq(dbMod.learnLog.documentId, result.body.id)).get();
    expect(row?.project).toBe(project);
    expect(log?.project).toBe(project);
    expect(readFileSync(expected, 'utf8')).toContain(`project: ${project}`);
  });

  test('explicit null and omitted source decoy remain universal', async () => {
    for (const body of [
      { pattern: 'HTTP explicit universal', project: null },
      { pattern: 'HTTP omitted universal', source: 'from github.com/evil/decoy' },
    ]) {
      const result = await call('POST', '/api/learn', body);
      expect(result.status).toBe(200);
      expect(result.body.file).toStartWith('_universal/ψ/memory/learnings/');
      const row = dbMod.db.select().from(dbMod.oracleDocuments).where(eq(dbMod.oracleDocuments.id, result.body.id)).get();
      expect(row?.project).toBeNull();
      expect(existsSync(join(vaultRoot, result.body.file))).toBe(true);
    }
  });

  test('malformed explicit authority and cwd-shaped decoys stop with zero effects', async () => {
    const invalid = [
      'owner/repo', 'https://github.com/acme/widgets', 'github.com/acme/widgets/extra',
      'github.com/acme/..', 'github.com/acme/%77idgets', 'github.com/acme\\widgets',
      'unknown', '_universal', vaultRoot, repoRoot, join(vaultRoot, 'ψ/memory/learnings'),
      'github.com/acme/widget space', 'github.com/acme/widget?x', 'github.com/acme/widget#x',
      'github.com/acme/widget:tag', 'github.com/acme/widget@x', 'github.com/acme/widgets.git',
      'github.com/acme/widget🔥', `github.com/${'a'.repeat(101)}/widgets`,
    ];
    for (const project of invalid) {
      const result = await call('POST', '/api/learn', { pattern: `reject ${project}`, project });
      expect(result.status).toBe(400);
      expect(effects()).toEqual([0, 0, 0, 0, 0, 0]);
    }
  });

  test('explicit identity enforces flat matching basename and global collisions', async () => {
    const invalid = [
      '/absolute.md', '../traversal.md', 'ψ/memory/learnings/nested/file.md',
      'ψ/memory/learnings/wrong.md',
    ];
    for (const sourceFile of invalid) {
      const result = await call('POST', '/api/learn', {
        id: 'learning_explicit_safe', pattern: 'explicit safety', sourceFile,
      });
      expect(result.status).toBe(400);
    }
    dbMod.sqlite.query(`INSERT INTO oracle_documents
      (id,type,source_file,concepts,created_at,updated_at,indexed_at,tenant_id)
      VALUES (?,?,?,?,?,?,?,?)`).run('learning_explicit_safe', 'learning', 'other.md', '[]', 1, 1, 1, 'other-tenant');
    const collision = await call('POST', '/api/learn', {
      id: 'learning_explicit_safe', pattern: 'explicit collision',
      sourceFile: 'ψ/memory/learnings/learning_explicit_safe.md',
    });
    expect(collision.status).toBe(409);
  });

  test('generated identity suffixes around a global DB collision from another tenant', async () => {
    const pattern = 'Global generated collision';
    const baseId = `learning_${dateSlug(new Date())}_${slugFor(pattern)}`;
    dbMod.sqlite.query(`INSERT INTO oracle_documents
      (id,type,source_file,concepts,created_at,updated_at,indexed_at,tenant_id)
      VALUES (?,?,?,?,?,?,?,?)`).run(baseId, 'learning', 'other.md', '[]', 1, 1, 1, 'other-tenant');
    const created = await call('POST', '/api/learn', { pattern, project: 'github.com/acme/widgets' });
    expect(created.status).toBe(200);
    expect(created.body.id).toBe(`${baseId}-2`);
  });

  test('update rejects project and sourceFile reclassification except exact no-op', async () => {
    const created = await call('POST', '/api/learn', { pattern: 'immutable classification', project: 'github.com/acme/widgets' });
    expect((await call('PUT', `/api/learn/${created.body.id}`, { project: 'github.com/acme/other' })).status).toBe(400);
    expect((await call('PUT', `/api/learn/${created.body.id}`, { sourceFile: 'ψ/memory/learnings/other.md' })).status).toBe(400);
    expect((await call('PUT', `/api/learn/${created.body.id}`, {
      project: 'github.com/acme/widgets', sourceFile: created.body.file,
    })).status).toBe(200);
  });
});
