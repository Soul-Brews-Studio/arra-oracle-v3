import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { filterResultsAsOf } from '../../../src/search/bitemporal.ts';
import { attachSupersedeStatus } from '../../../src/search/supersede-status.ts';

function memoryDb() {
  const sqlite = new Database(':memory:');
  sqlite.run(`
    CREATE TABLE oracle_documents (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      valid_time,
      updated_at,
      created_at,
      indexed_at,
      superseded_by TEXT,
      superseded_at,
      superseded_reason TEXT
    )
  `);
  return sqlite;
}

describe('search temporal/supersede status hardening', () => {
  test('attachSupersedeStatus formats legacy ISO text superseded_at values', () => {
    const sqlite = memoryDb();
    try {
      sqlite.prepare(`
        INSERT INTO oracle_documents
          (id, tenant_id, superseded_by, superseded_at, superseded_reason)
        VALUES (?, ?, ?, ?, ?)
      `).run('old', 'tenant-a', 'new', '2026-06-17T00:00:00.000Z', 'replacement');
      const results: Array<Record<string, unknown>> = [{ id: 'old' }];

      attachSupersedeStatus(sqlite, results, 'tenant-a');

      expect(results[0]).toMatchObject({
        superseded_by: 'new',
        superseded_at: '2026-06-17T00:00:00.000Z',
        superseded_reason: 'replacement',
        superseded: { by: 'new', at: '2026-06-17T00:00:00.000Z', reason: 'replacement' },
      });
    } finally {
      sqlite.close();
    }
  });

  test('attachSupersedeStatus sets null status for current results', () => {
    const sqlite = memoryDb();
    try {
      const results: Array<Record<string, unknown>> = [{ id: 'current' }];
      attachSupersedeStatus(sqlite, results, 'tenant-a');
      expect(results[0]).toEqual({ id: 'current', superseded: null });
    } finally {
      sqlite.close();
    }
  });

  test('filterResultsAsOf compares and emits ISO text temporal columns', () => {
    const sqlite = memoryDb();
    const valid = '2025-01-01T00:00:00.000Z';
    const asOf = Date.parse('2025-06-01T00:00:00.000Z');
    try {
      sqlite.prepare(`
        INSERT INTO oracle_documents
          (id, tenant_id, valid_time, updated_at, created_at, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('fact', 'tenant-a', valid, Date.parse(valid), Date.parse(valid), Date.parse(valid));

      const filtered = filterResultsAsOf(sqlite, [{ id: 'fact' }], asOf, 'tenant-a');

      expect(filtered).toEqual([{
        id: 'fact',
        valid_time: '2025-01-01T00:00:00.000Z',
        valid_until: null,
      }]);
    } finally {
      sqlite.close();
    }
  });
});
