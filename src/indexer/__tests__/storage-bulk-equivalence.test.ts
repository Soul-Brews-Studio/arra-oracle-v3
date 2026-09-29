import { expect, test } from 'bun:test';
import { createDatabase } from '../../db/index.ts';
import { storeDocuments } from '../storage.ts';
import { replacements, seed, snapshot } from './storage-bulk-fixture.ts';
import { storeDocumentsLegacy } from './storage-legacy.ts';

for (const tenantId of ['default', ' team-a ', '']) {
  test(`bulk storage matches legacy FTS and memberships for tenant ${JSON.stringify(tenantId)}`, async () => {
    const actual = createDatabase(':memory:');
    const legacy = createDatabase(':memory:');
    try {
      await seed(actual, tenantId);
      await seed(legacy, tenantId);
      const preserved = actual.sqlite.prepare('SELECT rowid, * FROM oracle_fts WHERE id = ?').all('preserved');

      await storeDocuments(actual.sqlite, actual.db, null, 'Repo/Project', replacements(), { tenantId });
      await storeDocumentsLegacy(legacy.sqlite, legacy.db, null, 'Repo/Project', replacements(), { tenantId });

      expect(snapshot(actual.sqlite)).toEqual(snapshot(legacy.sqlite));
      expect(actual.sqlite.prepare('SELECT rowid, * FROM oracle_fts WHERE id = ?').all('preserved'))
        .toEqual(preserved);
      expect(actual.sqlite.prepare('SELECT count(*) AS n FROM oracle_fts WHERE id = ?').get('changed'))
        .toEqual({ n: 1 });
      expect(actual.sqlite.prepare('SELECT content FROM oracle_fts WHERE id = ?').get('emptied'))
        .toEqual({ content: '' });
      const memberships = actual.sqlite.prepare('SELECT doc_ids FROM oracle_pointer_index').all() as { doc_ids: string }[];
      expect(memberships.flatMap((row) => JSON.parse(row.doc_ids))).not.toContain('emptied');
      expect(actual.sqlite.prepare('SELECT id FROM oracle_pointer_index WHERE key IN (?, ?, ?)')
        .all('obsolete', 'transient', 'transient-new')).toEqual([]);

      const beforeEmptyBatch = snapshot(actual.sqlite);
      await storeDocuments(actual.sqlite, actual.db, null, null, [], { tenantId });
      expect(snapshot(actual.sqlite)).toEqual(beforeEmptyBatch);
    } finally {
      actual.storage.close();
      legacy.storage.close();
    }
  });
}
