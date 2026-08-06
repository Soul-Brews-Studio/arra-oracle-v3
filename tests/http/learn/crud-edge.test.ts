import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const savedRepoRoot = process.env.ORACLE_REPO_ROOT;
const root = join(tmpdir(), `arra-learn-edge-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');
const repoRoot = join(root, 'repo');
mkdirSync(repoRoot, { recursive: true });
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;
process.env.ORACLE_REPO_ROOT = repoRoot;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { createLearnCrudRoutes } = await import('../../../src/routes/learn/index.ts');

function app() {
  return new Elysia({ prefix: '/api' }).use(createLearnCrudRoutes());
}

async function call(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await app().handle(new Request(`http://local${path}`, init));
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

beforeEach(() => {
  dbMod.db.delete(dbMod.learnLog).run();
  dbMod.db.delete(dbMod.oracleDocuments)
    .where(eq(dbMod.oracleDocuments.type, 'learning'))
    .run();
});

afterAll(() => {
  dbMod.resetDefaultDatabaseForTests(':memory:');
  restoreEnv('ORACLE_DATA_DIR', savedDataDir);
  restoreEnv('ORACLE_DB_PATH', savedDbPath);
  restoreEnv('ORACLE_REPO_ROOT', savedRepoRoot);
  rmSync(root, { recursive: true, force: true });
});

describe('POST/DELETE /api/learn edge cases', () => {
  test('uses explicit ids, comma concepts, duplicate guards, and missing deletes', async () => {
    const created = await call('POST', '/api/learn', {
      id: 'learning_edge_explicit',
      pattern: 'Explicit learn edge coverage',
      concepts: 'edge, coverage',
      sourceFile: 'ψ/memory/learnings/edge-explicit.md',
    });
    expect(created.status).toBe(200);
    expect(created.json).toMatchObject({ id: 'learning_edge_explicit' });

    const read = await call('GET', '/api/learn/learning_edge_explicit');
    expect(read.status).toBe(200);
    expect(read.json.concepts).toEqual(['edge', 'coverage']);

    const missingRead = await call('GET', '/api/learn/learning_missing_edge');
    expect(missingRead.status).toBe(404);
    expect(missingRead.json.error).toBe('Learning not found');

    const firstAuto = await call('POST', '/api/learn', { pattern: 'Collision Pattern' });
    const secondAuto = await call('POST', '/api/learn', { pattern: 'Collision Pattern' });
    expect(firstAuto.status).toBe(200);
    expect(secondAuto.status).toBe(200);
    expect(secondAuto.json.id).not.toBe(firstAuto.json.id);

    const duplicate = await call('POST', '/api/learn', {
      id: 'learning_edge_explicit',
      pattern: 'Duplicate explicit id',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.json.error).toMatch(/already exists/);

    const missingDelete = await call('DELETE', '/api/learn/learning_missing_edge');
    expect(missingDelete.status).toBe(404);
    expect(missingDelete.json.error).toBe('Learning not found');
  });

  test('rejects unsafe ids and sourceFile traversal without writing outside repo', async () => {
    const badId = await call('POST', '/api/learn', {
      id: '../escape',
      pattern: 'Unsafe id should not become a file path',
    });
    expect(badId.status).toBe(400);
    expect(badId.json.error).toBe('Invalid learning id');

    const traversal = await call('POST', '/api/learn', {
      pattern: 'Unsafe source paths should be rejected',
      sourceFile: '../outside.md',
    });
    expect(traversal.status).toBe(400);
    expect(traversal.json.error).toBe('Invalid learning sourceFile');
    expect(existsSync(join(root, 'outside.md'))).toBe(false);

    const created = await call('POST', '/api/learn', {
      id: 'learning_safe_source',
      pattern: 'Safe learning source',
      sourceFile: 'ψ/memory/learnings/safe-source.md',
    });
    expect(created.status).toBe(200);

    const update = await call('PUT', '/api/learn/learning_safe_source', {
      sourceFile: '../../outside.md',
    });
    expect(update.status).toBe(400);
    expect(update.json.error).toBe('Invalid learning sourceFile');

    const read = await call('GET', '/api/learn/learning_safe_source');
    expect(read.json.sourceFile).toBe('ψ/memory/learnings/safe-source.md');
  });

  test('sanitizes markdown frontmatter scalars when creating learnings', async () => {
    const created = await call('POST', '/api/learn', {
      id: 'learning_injection_safe',
      pattern: 'Frontmatter title\nproject: evil\n---\nbody stays in markdown',
      concepts: ['alpha, beta', 'gamma\nproject: evil'],
      source: 'ui\nhash: fake',
      sourceFile: 'ψ/memory/learnings/injection-safe.md',
    });
    expect(created.status).toBe(200);

    const markdown = readFileSync(join(repoRoot, 'ψ/memory/learnings/injection-safe.md'), 'utf-8');
    const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    expect(frontmatter.match(/^source:/gm)).toHaveLength(1);
    expect(frontmatter.match(/^hash:/gm)).toBeNull();
    expect(frontmatter.match(/^project:/gm)).toBeNull();
    expect(frontmatter).toContain('tags: [alpha beta, gamma project evil]');
    expect(markdown).toContain('body stays in markdown');
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
