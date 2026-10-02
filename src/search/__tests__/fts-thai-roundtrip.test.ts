import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { createDatabase } from '../../db/create.ts';
import { storeDocuments } from '../../indexer/storage.ts';
import { document } from '../../indexer/__tests__/storage-bulk-fixture.ts';
import { sanitizeFtsQuery } from '../../tools/search/helpers.ts';
import { buildTenantFtsQuery } from '../query.ts';
import { buildFtsQuery } from '../../server/handlers.ts';

test('production indexing and all query builders retrieve Thai, English and mixed text', async () => {
  const conn = createDatabase(':memory:');
  try {
    await storeDocuments(conn.sqlite, conn.db, null, null, [document('thai', {
      content: 'ฉันชอบภาษาไทยและการเขียนโปรแกรมนักบัญชียิ้มเสมอ deploying memories dockers',
      concepts: [],
    })]);
    for (const query of ['ภาษาไทย', 'บัญชี', 'ยิ้ม', 'โปรแกรม', 'deploy', 'memory', 'docker', 'ภาษาไทย docker']) {
      for (const build of [sanitizeFtsQuery, buildTenantFtsQuery, buildFtsQuery]) {
        expect(conn.sqlite.query('SELECT id FROM oracle_fts WHERE oracle_fts MATCH ?').all(build(query)))
          .toEqual([{ id: 'thai' }]);
      }
    }
  } finally { conn.storage.close(); }
});

test('Thai multi-token queries require adjacency and order', async () => {
  const conn = createDatabase(':memory:');
  try {
    await storeDocuments(conn.sqlite, conn.db, null, null, [
      document('yes', { content: 'ภาษาไทย' }),
      document('reversed', { content: 'ไทยภาษา' }),
      document('apart', { content: 'ภาษาอังกฤษและไทย' }),
    ]);
    expect(conn.sqlite.query('SELECT id FROM oracle_fts WHERE oracle_fts MATCH ?').all(sanitizeFtsQuery('ภาษาไทย')))
      .toEqual([{ id: 'yes' }]);
  } finally { conn.storage.close(); }
});

test('old unsegmented porter unicode61 index misses โปรแกรม in a Thai sentence', () => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.exec("CREATE VIRTUAL TABLE old_fts USING fts5(content, tokenize='porter unicode61')");
    sqlite.query('INSERT INTO old_fts(content) VALUES (?)').run('ฉันชอบภาษาไทยและการเขียนโปรแกรม');
    expect(sqlite.query('SELECT count(*) AS n FROM old_fts WHERE old_fts MATCH ?').get('"โปรแกรม"'))
      .toEqual({ n: 0 });
    expect(sqlite.query('SELECT count(*) AS n FROM old_fts WHERE content LIKE ?').get('%โปรแกรม%'))
      .toEqual({ n: 1 });
  } finally { sqlite.close(); }
});
