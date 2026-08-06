import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import {
  VectorDocumentsPage,
  contentPreview,
  normalizeVectorCollections,
  normalizeVectorDocuments,
} from '../../../frontend/src/pages/VectorDocumentsPage';
import { htmlFor } from '../_render';

describe('VectorDocumentsPage', () => {
  test('renders the document browser controls', () => {
    const html = htmlFor(<MemoryRouter><VectorDocumentsPage /></MemoryRouter>);
    expect(html).toContain('Vector documents');
    expect(html).toContain('aria-label="Vector collection"');
    expect(html).toContain('Previous');
    expect(html).toContain('Next');
  });

  test('normalizes model response collections', () => {
    const collections = normalizeVectorCollections({
      models: {
        'bge-m3': { collection: 'oracle_knowledge', model: 'bge-m3', adapter: 'lancedb', count: 12 },
      },
    });
    expect(collections).toEqual([{ key: 'bge-m3', collection: 'oracle_knowledge', model: 'bge-m3', adapter: 'lancedb', count: 12 }]);
  });

  test('normalizes mocked documents endpoint response', () => {
    const response = normalizeVectorDocuments({
      documents: [{ id: 'doc-1', content: 'hello world', metadata: { type: 'learning', source_file: 'notes/a.md' } }],
      total: 51,
      page: 1,
      limit: 50,
    }, 1, 50);
    expect(response.documents[0]).toMatchObject({ id: 'doc-1', type: 'learning', source_file: 'notes/a.md' });
    expect(response.hasNext).toBe(true);
  });

  test('caps previews at the first 100 characters', () => {
    expect(contentPreview('x'.repeat(101))).toBe(`${'x'.repeat(100)}…`);
  });
});
