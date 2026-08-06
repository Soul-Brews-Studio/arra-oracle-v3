import { describe, expect, test } from 'bun:test';
import { contentPreview, normalizeVectorCollections, normalizeVectorDocuments } from '../../../frontend/src/pages/VectorDocumentsPage';

describe('VectorDocumentsPage normalization edges', () => {
  test('accepts array collection payloads and fills stable collection fallbacks', () => {
    expect(normalizeVectorCollections({ models: [{ key: 'nomic', count: 7 }, 'bad'] })).toEqual([
      { key: 'nomic', collection: 'nomic', model: '', adapter: '', count: 7 },
      { key: 'collection-2', collection: 'collection-2', model: '', adapter: '', count: undefined },
    ]);
  });

  test('normalizes document aliases and derives pagination when hasNext is absent', () => {
    const response = normalizeVectorDocuments({
      items: [{ document: '  one\n two  ', sourceFile: 'notes/a.md', metadata: { type: 'note' } }, null],
      total: 75,
    }, 1, 50);

    expect(response.hasNext).toBe(true);
    expect(response.documents[0]).toMatchObject({ id: 'document-1', content: '  one\n two  ', type: 'note', source_file: 'notes/a.md' });
    expect(response.documents[1]).toMatchObject({ id: 'document-2', content: '', type: '—', source_file: '—' });
    expect(contentPreview('  one\n   two  ')).toBe('one two');
  });
});
