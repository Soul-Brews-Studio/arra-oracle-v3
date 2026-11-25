/** #3114: the batch pointer update must leave exactly the rows the per-document path leaves. */
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase } from '../../db/index.ts';
import { replaceDocumentPointers, type PointerInput } from '../pointer-index.ts';
import { replaceDocumentPointersBatch } from '../pointer-batch.ts';

const fresh = () => createDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-batch-')), 'oracle.db')).sqlite;
const rows = (s: ReturnType<typeof fresh>) => s.query('SELECT id, kind, key, doc_ids FROM oracle_pointer_index ORDER BY id').all();
const doc = (i: number, concepts: string[]): PointerInput => ({
  documentId: `d${i}`, tenantId: 'default', concepts, timestamp: Date.UTC(2026, 10, 25),
  content: `Note ${i} about VectorStoreAdapter and src/indexer/storage.ts, issue #3114, topic ${i % 3}`,
});

describe('replaceDocumentPointersBatch', () => {
  test('a fresh import gives the same pointer rows as one call per document', () => {
    const docs = Array.from({ length: 40 }, (_, i) => doc(i, [['arra', 'hub', 'ane'][i % 3], 'learning']));
    const a = fresh(); for (const d of docs) replaceDocumentPointers(a, d);
    const b = fresh(); replaceDocumentPointersBatch(b, 'default', docs);
    expect(rows(b)).toEqual(rows(a));
    expect(rows(b).length).toBeGreaterThan(5);
  });
  test('re-indexing a document drops it from keys it no longer has', () => {
    const before = [doc(1, ['arra']), doc(2, ['arra'])];
    const after = [doc(1, ['hub'])]; // d1 changed concept arra -> hub; d2 untouched
    const a = fresh(); for (const d of before) replaceDocumentPointers(a, d); for (const d of after) replaceDocumentPointers(a, d);
    const b = fresh(); replaceDocumentPointersBatch(b, 'default', before); replaceDocumentPointersBatch(b, 'default', after, ['d1']);
    expect(rows(b)).toEqual(rows(a));
    const arra = rows(b).find((r: any) => r.id === 'default:topic:arra') as { doc_ids: string };
    expect(JSON.parse(arra.doc_ids)).toEqual(['d2']);
  });
});
