import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = join(tmpdir(), `arra-trace-validation-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');
mkdirSync(root, { recursive: true });
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { traceLinkRoute } = await import('../../../src/routes/traces/link.ts');
const { traceUnlinkRoute } = await import('../../../src/routes/traces/unlink.ts');

function postLink(body: unknown) {
  return traceLinkRoute.handle(new Request('http://local/api/traces/a/link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

function deleteLink(query = '') {
  return traceUnlinkRoute.handle(new Request(`http://local/api/traces/a/link${query}`, {
    method: 'DELETE',
  }));
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterAll(() => {
  dbMod.closeDb();
  restore('ORACLE_DATA_DIR', savedDataDir);
  restore('ORACLE_DB_PATH', savedDbPath);
  rmSync(root, { recursive: true, force: true });
});

describe('trace link route input validation', () => {
  test('rejects missing or non-string nextId before link handling', async () => {
    expect((await postLink({})).status).toBe(422);
    expect((await postLink({ nextId: 42 })).status).toBe(422);
  });

  test('rejects unlink directions outside the prev|next allowlist', async () => {
    expect((await deleteLink()).status).toBe(400);
    expect((await deleteLink('?direction=sideways')).status).toBe(422);
  });
});
