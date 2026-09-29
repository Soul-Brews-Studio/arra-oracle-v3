import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb, resetDefaultDatabaseForTests } from '../../../db/index.ts';
import { oracleDig } from '../index.ts';

let root = '';
const previous = { private: process.env.ORACLE_PRIVATE_DEPLOYMENT, db: process.env.ORACLE_DB_PATH };

afterEach(() => {
  closeDb();
  if (previous.private === undefined) delete process.env.ORACLE_PRIVATE_DEPLOYMENT; else process.env.ORACLE_PRIVATE_DEPLOYMENT = previous.private;
  if (previous.db === undefined) delete process.env.ORACLE_DB_PATH; else process.env.ORACLE_DB_PATH = previous.db;
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('private oracle_dig write approval', () => {
  test('requires explicit approval in private deployment', async () => {
    root = mkdtempSync(join(tmpdir(), 'oracle-dig-private-')); mkdirSync(root, { recursive: true });
    process.env.ORACLE_PRIVATE_DEPLOYMENT = '1'; process.env.ORACLE_DB_PATH = join(root, 'oracle.db');
    resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
    const result = await oracleDig({ source: 'mcp', plugin: 'oracle-dig', body: {
      subject: 'private finding', dug_by: 'test', evidence: [{ kind: 'web', web: { url: 'https://example.test' } }],
    } });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });
});
