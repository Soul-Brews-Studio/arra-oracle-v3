/** MCP keyword search reads one tenant: the caller's, or default when none (#3110). */
import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runWithTenant } from '../../../middleware/tenant.ts';
import { searchFts } from '../fts.ts';
import type { ToolContext } from '../../types.ts';

function ctx(): ToolContext {
  const sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE oracle_documents (id TEXT PRIMARY KEY, type TEXT, source_file TEXT, concepts TEXT, project TEXT, tenant_id TEXT);
    CREATE VIRTUAL TABLE oracle_fts USING fts5(id UNINDEXED, content);`);
  for (const [id, tenant] of [['a', 'default'], ['b', null], ['neo:a', 'neo'], ['pulse:a', 'pulse']] as const) {
    sqlite.query('INSERT INTO oracle_documents VALUES (?, ?, ?, ?, ?, ?)').run(id, 'learning', `${id}.md`, '[]', null, tenant);
    sqlite.query('INSERT INTO oracle_fts VALUES (?, ?)').run(id, 'shared wisdom');
  }
  return { sqlite } as unknown as ToolContext;
}
const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();

test('no tenant: default rows only (legacy NULL counts as default)', () => {
  expect(ids(searchFts(ctx(), 'wisdom', 'all', 10, null))).toEqual(['a', 'b']);
});

test('a tenant sees only its own rows', async () => {
  const c = ctx();
  expect(ids(await runWithTenant('neo', () => searchFts(c, 'wisdom', 'all', 10, null)))).toEqual(['neo:a']);
  expect(ids(await runWithTenant('pulse', () => searchFts(c, 'wisdom', 'all', 10, null)))).toEqual(['pulse:a']);
});
