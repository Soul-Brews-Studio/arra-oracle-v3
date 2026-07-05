import { afterAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const root = mkdtempSync(join(tmpdir(), 'arra-memory-consolidation-'));
process.env.ORACLE_DATA_DIR = root;

const { createDatabase, oracleMemories, resetDefaultDatabaseForTests } = await import('../../src/db/index.ts');
const { runMemoryConsolidationWorker } = await import('../../src/workers/memory-consolidation.ts');

type Connection = ReturnType<typeof createDatabase>;

const now = Date.parse('2026-06-17T00:00:00.000Z');
const text = 'Cloudflare MCP deploy uses wrangler config, OAuth client setup, and mcp-remote connection notes.';

function connection(name: string): Connection {
  return createDatabase(join(root, `${name}.db`));
}

function addMemory(conn: Connection, id: string, tenantId: string, updatedAt: number, title = 'MCP deploy') {
  conn.db.insert(oracleMemories).values({
    id,
    tenantId,
    content: text,
    title,
    tags: JSON.stringify(['cloudflare', 'mcp']),
    source: 'docs/deploy-cloudflare-mcp.md',
    createdAt: updatedAt - 1000,
    updatedAt,
  }).run();
}

function row(conn: Connection, id: string) {
  return conn.db.select({ supersededBy: oracleMemories.supersededBy, supersededAt: oracleMemories.supersededAt })
    .from(oracleMemories)
    .where(eq(oracleMemories.id, id))
    .get();
}

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  resetDefaultDatabaseForTests(':memory:');
  if (existsSync(root)) rmSync(root, { recursive: true });
});

describe('memory consolidation worker', () => {
  test('dry-run plans near-duplicate memory supersede without mutating rows', async () => {
    const conn = connection('dry-run');
    addMemory(conn, 'old-memory', 'tenant-a', now - 45 * 86_400_000);
    addMemory(conn, 'hot-memory', 'tenant-a', now);
    const logs: string[] = [];

    try {
      const result = await runMemoryConsolidationWorker(conn.db, {
        dryRun: true,
        now: new Date(now),
        logger: { log: (line) => logs.push(String(line)), warn: () => {} },
      });

      expect(result).toMatchObject({ dryRun: true, scanned: 2, planned: 1, applied: 0, deleted: 0 });
      expect(result.plans[0]).toMatchObject({ oldId: 'old-memory', newId: 'hot-memory', tenantId: 'tenant-a' });
      expect(logs[0]).toContain('would supersede old-memory -> hot-memory');
      expect(row(conn, 'old-memory')?.supersededBy).toBeNull();
    } finally {
      conn.storage.close();
    }
  });

  test('apply mode supersedes the lower confidence+heat memory and keeps both rows', async () => {
    const conn = connection('apply');
    addMemory(conn, 'cold-memory', 'tenant-a', now - 90 * 86_400_000, undefined);
    addMemory(conn, 'survivor-memory', 'tenant-a', now, 'MCP deploy');

    try {
      const result = await runMemoryConsolidationWorker(conn.db, { dryRun: false, now: new Date(now) });
      const count = conn.db.select({ id: oracleMemories.id }).from(oracleMemories).all().length;

      expect(result).toMatchObject({ dryRun: false, planned: 1, applied: 1, deleted: 0 });
      expect(row(conn, 'cold-memory')).toMatchObject({ supersededBy: 'survivor-memory', supersededAt: now });
      expect(count).toBe(2);
    } finally {
      conn.storage.close();
    }
  });

  test('does not consolidate near-duplicates across tenants', async () => {
    const conn = connection('tenants');
    addMemory(conn, 'tenant-a-memory', 'tenant-a', now);
    addMemory(conn, 'tenant-b-memory', 'tenant-b', now);

    try {
      const result = await runMemoryConsolidationWorker(conn.db, { dryRun: true, now: new Date(now) });
      expect(result.plans).toEqual([]);
    } finally {
      conn.storage.close();
    }
  });
});
