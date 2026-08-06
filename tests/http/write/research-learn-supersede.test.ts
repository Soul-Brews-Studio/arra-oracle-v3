import { afterAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

await import('../../../src/config.ts');

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const savedRepoRoot = process.env.ORACLE_REPO_ROOT;
const savedVectorDisabled = process.env.ORACLE_VECTOR_DISABLED;
const root = join(tmpdir(), `arra-write-hardening-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dataDir = join(root, 'data');
const repoRoot = join(root, 'repo');
const dbPath = join(dataDir, 'oracle.db');
mkdirSync(repoRoot, { recursive: true });
process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = dbPath;
process.env.ORACLE_REPO_ROOT = repoRoot;
process.env.ORACLE_VECTOR_DISABLED = '1';

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { createTenantFetch, TENANT_HEADER } = await import('../../../src/middleware/tenant.ts');
const { knowledgeRoutes } = await import('../../../src/routes/knowledge/index.ts');
const { researchRoutes } = await import('../../../src/routes/research/index.ts');
const { supersedeRoutes } = await import('../../../src/routes/supersede/index.ts');
const { createMcpRoutes } = await import('../../../src/routes/mcp/index.ts');

const app = new Elysia()
  .use(knowledgeRoutes)
  .use(researchRoutes)
  .use(supersedeRoutes)
  .use(createMcpRoutes());
const stamp = `${Date.now()}${Math.random().toString(16).slice(2)}`;
const tenantId = `tenant-write-${stamp}`;

function api(pathname: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set(TENANT_HEADER, tenantId);
  if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return createTenantFetch((request) => app.handle(request))(new Request(`http://local${pathname}`, {
    ...init,
    headers,
  }));
}

function json(method: string, pathname: string, body: unknown) {
  return api(pathname, { method, body: JSON.stringify(body) });
}

function insertDoc(id: string) {
  const now = Date.now();
  dbMod.db.insert(dbMod.oracleDocuments).values({
    id,
    tenantId,
    type: 'learning',
    sourceFile: `ψ/memory/${id}.md`,
    concepts: JSON.stringify(['write-hardening']),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    createdBy: 'write-hardening-test',
  }).run();
  dbMod.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(id, `write hardening ${id}`, 'write-hardening');
}

function supersededBy(id: string): string | null {
  return dbMod.db.select({ value: dbMod.oracleDocuments.supersededBy })
    .from(dbMod.oracleDocuments)
    .where(eq(dbMod.oracleDocuments.id, id))
    .get()?.value ?? null;
}

afterAll(() => {
  dbMod.closeDb();
  restoreEnv('ORACLE_DATA_DIR', savedDataDir);
  restoreEnv('ORACLE_DB_PATH', savedDbPath);
  restoreEnv('ORACLE_REPO_ROOT', savedRepoRoot);
  restoreEnv('ORACLE_VECTOR_DISABLED', savedVectorDisabled);
  rmSync(root, { recursive: true, force: true });
});

describe('HTTP write route hardening', () => {
  test('oracle_learn rejects sourceFile collisions without overwriting files', async () => {
    const sourceFile = `ψ/memory/learnings/write-${stamp}.md`;
    const first = await json('POST', '/api/learn', {
      id: `learning-write-a-${stamp}`,
      pattern: `append-only first ${stamp}`,
      sourceFile,
    });
    expect(first.status).toBe(200);
    const fullPath = join(repoRoot, sourceFile);
    expect(existsSync(fullPath)).toBe(true);
    const original = readFileSync(fullPath, 'utf-8');

    const second = await json('POST', '/api/learn', {
      id: `learning-write-b-${stamp}`,
      pattern: `append-only second ${stamp}`,
      sourceFile,
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'Learning sourceFile already exists' });
    expect(readFileSync(fullPath, 'utf-8')).toBe(original);
  });

  test('oracle_research_note has a REST route and malformed title guard', async () => {
    const manifest = await api('/api/mcp/tools');
    const listed = await manifest.json() as { tools: Array<{ name: string; remoteable?: boolean; rest?: { path: string } }> };
    expect(listed.tools.find((tool) => tool.name === 'oracle_research_note')).toMatchObject({
      remoteable: true,
      rest: { path: '/api/research/note' },
    });

    const bad = await json('POST', '/api/research/note', { title: '   ', repoEvidence: [{ path: 'x.ts' }] });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ success: false, error: 'oracle_research_note requires title' });

    const good = await json('POST', '/api/research/note', {
      title: `Stormforge write note ${stamp}`,
      repo: 'github.com/Soul-Brews-Studio/arra-oracle-v3',
      repoEvidence: [{ path: 'src/routes/research/index.ts', summary: 'HTTP route stores research notes.' }],
      concepts: ['write-hardening'],
    });
    const body = await good.json() as { success: boolean; id: string; file: string };
    expect(good.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.id).toStartWith('learning_');
    expect(readFileSync(join(repoRoot, body.file), 'utf-8')).toContain('Stormforge write note');
  });

  test('oracle_supersede preserves reversible chains and rejects rewrites/cycles', async () => {
    const a = `sup-a-${stamp}`;
    const b = `sup-b-${stamp}`;
    const c = `sup-c-${stamp}`;
    [a, b, c].forEach(insertDoc);

    const first = await json('POST', '/api/supersede/document', { oldId: a, newId: b, reason: 'first edge' });
    expect(first.status).toBe(200);
    expect(supersededBy(a)).toBe(b);

    const rewrite = await json('POST', '/api/supersede/document', { oldId: a, newId: c, reason: 'rewrite' });
    expect(rewrite.status).toBe(400);
    expect((await rewrite.json() as { error: string }).error).toContain('already superseded');
    expect(supersededBy(a)).toBe(b);

    const extend = await json('POST', '/api/supersede/document', { oldId: b, newId: c, reason: 'extend' });
    expect(extend.status).toBe(200);

    const chain = await api(`/api/supersede/chain/${encodeURIComponent(`ψ/memory/${b}.md`)}`);
    const chainBody = await chain.json() as { supersedes: Array<{ old_path: string }>; superseded_by: Array<{ new_path: string }> };
    expect(chainBody.supersedes.map((item) => item.old_path)).toEqual([`ψ/memory/${a}.md`]);
    expect(chainBody.superseded_by.map((item) => item.new_path)).toEqual([`ψ/memory/${c}.md`]);

    const cycle = await json('POST', '/api/supersede/document', { oldId: c, newId: a });
    expect(cycle.status).toBe(400);
    expect((await cycle.json() as { error: string }).error).toContain('cycle');
    expect(supersededBy(c)).toBeNull();
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
