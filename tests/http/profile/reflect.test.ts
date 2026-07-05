import { afterAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests();
const { searchRoutes } = await import('../../../src/routes/search/index.ts');
const { handleReflect } = await import('../../../src/tools/reflect.ts');

const id = `profile-reflect-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const now = Date.now();

dbMod.db.insert(dbMod.oracleDocuments).values({
  id,
  type: 'principle',
  sourceFile: `ψ/memory/${id}.md`,
  concepts: '{not-json',
  createdAt: now,
  updatedAt: now,
  indexedAt: now,
}).run();
dbMod.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
  .run(id, 'reflect malformed concepts should not crash', '');

afterAll(() => {
  dbMod.db.delete(dbMod.oracleDocuments).where(eq(dbMod.oracleDocuments.id, id)).run();
  dbMod.sqlite.prepare('DELETE FROM oracle_fts WHERE id = ?').run(id);
  dbMod.resetDefaultDatabaseForTests(':memory:');
});

const ctx = {
  db: dbMod.db,
  sqlite: dbMod.sqlite,
  repoRoot: process.cwd(),
  vectorStore: {} as never,
  vectorStatus: 'unknown' as const,
  version: 'test',
};

describe('oracle reflect random-principle edge cases', () => {
  test('returns reflection even when stored concepts payload is malformed', async () => {
    const res = await searchRoutes.handle(new Request('http://local/api/reflect'));
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ id, type: 'principle', concepts: [] });
    expect(body.content).toBe('reflect malformed concepts should not crash');
  });

  test('MCP reflect tool also tolerates malformed stored concepts', async () => {
    const response = await handleReflect(ctx, {});
    const payload = JSON.parse(response.content[0].text) as { principle: { id: string; concepts: string[] } };

    expect(payload.principle.id).toBe(id);
    expect(payload.principle.concepts).toEqual([]);
  });
});
