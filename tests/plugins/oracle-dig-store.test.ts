import { afterEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDatabase, type DatabaseConnection } from '../../src/db/index.ts';
import { getFinding } from '../../src/plugins/oracle-dig/get.ts';
import { listFindings } from '../../src/plugins/oracle-dig/list.ts';
import { insertEvidence, insertFinding } from '../../src/plugins/oracle-dig/store.ts';

let tempDir = '';
let connection: DatabaseConnection | undefined;

afterEach(() => {
  connection?.storage.close();
  connection = undefined;
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  tempDir = '';
});

function freshDb(): DatabaseConnection {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-dig-store-'));
  connection = createDatabase(path.join(tempDir, 'oracle.db'));
  return connection;
}

test('insertFinding and insertEvidence persist typed provenance rows', () => {
  const conn = freshDb();
  const finding = insertFinding({
    subject: 'oracle_dig',
    relation: 'stores',
    object: 'provenance',
    dugBy: '[m5:digger]',
    asOfTs: Date.parse('2026-07-12T00:00:00.000Z'),
    asOfCommit: 'abc123',
    confidence: 0.92,
    topic: 'schema',
    frictionScore: 0.15,
    commissionedBy: '[m5:arra-oracle-v3]',
  }, conn.db);

  const github = insertEvidence({
    findingId: finding.id,
    kind: 'github',
    githubOwner: 'Soul-Brews-Studio',
    githubRepo: 'digger-oracle',
    githubPath: 'ψ/ralph/126-oracle-dig-mcp-tool-schema.md',
    githubRef: 'alpha',
    githubLine: 12,
    commit: 'abc123',
  }, conn.db);
  insertEvidence({ findingId: finding.id, kind: 'session', sessionId: 's-126', sessionOracle: '[m5:digger]' }, conn.db);

  expect(finding).toMatchObject({ tenantId: 'default', iterations: 1, subject: 'oracle_dig' });
  expect(github).toMatchObject({ tenantId: 'default', kind: 'github', githubRepo: 'digger-oracle' });

  const loaded = getFinding(finding.id, conn.db);
  expect(loaded?.evidence).toHaveLength(2);
  expect(loaded?.evidence.map((row) => row.kind)).toEqual(['github', 'session']);
});

test('listFindings filters by subject topic dug_by and confidence', () => {
  const conn = freshDb();
  const base = { asOfTs: 1783814400000, dugBy: '[m5:digger]' };
  insertFinding({ ...base, subject: 'oracle_dig schema', relation: 'has', object: 'evidence', confidence: 0.9, topic: 'schema' }, conn.db);
  insertFinding({ ...base, subject: 'oracle_trace primitive', relation: 'feeds', object: 'oracle_dig', confidence: 0.7, topic: 'trace' }, conn.db);
  insertFinding({ ...base, dugBy: '[m5:other]', subject: 'unrelated', relation: 'has', object: 'notes', confidence: 0.9, topic: 'schema' }, conn.db);

  expect(listFindings({ subject: 'oracle_', dug_by: '[m5:digger]' }, conn.db).total).toBe(2);
  expect(listFindings({ topic: 'schema', confidence: 0.9 }, conn.db).total).toBe(2);
  expect(listFindings({ dugBy: '[m5:digger]', confidence: 0.7 }, conn.db).findings[0].subject).toBe('oracle_trace primitive');
  expect(listFindings({ limit: 1, offset: 0 }, conn.db).hasMore).toBe(true);
});

test('getFinding returns null for missing ids and evidence requires a finding', () => {
  const conn = freshDb();
  expect(getFinding('missing', conn.db)).toBeNull();
  expect(() => insertEvidence({ findingId: 'missing', kind: 'web', webUrl: 'https://example.test' }, conn.db))
    .toThrow(/FOREIGN KEY|constraint/i);
});
