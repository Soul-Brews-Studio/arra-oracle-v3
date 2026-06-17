import { describe, expect, test } from 'bun:test';
import { ExportPage, normalizeExportCollections, normalizeExportFormats } from '../../../frontend/src/pages/ExportPage';
import { htmlFor } from '../_render';

describe('ExportPage', () => {
  test('normalizes collections, graph relationship pseudo-collection, and formats', () => {
    const payload = {
      collections: [
        { name: 'oracle_documents', rowCount: 3 },
        { key: 'learn_log', count: '2' },
      ],
      formats: ['json', 'csv', 'yaml', 'markdown'],
      graph: { collection: 'relationships' },
    };

    expect(normalizeExportCollections(payload)).toEqual([
      { id: 'learn_log', label: 'learn_log', rowCount: 2 },
      { id: 'oracle_documents', label: 'oracle_documents', rowCount: 3 },
      { id: 'relationships', label: 'Graph relationships' },
    ]);
    expect(normalizeExportFormats(payload)).toEqual(['json', 'csv', 'markdown']);
  });

  test('renders picker, export action, download progress, and backend controls', () => {
    const html = htmlFor(<ExportPage />);

    expect(html).toContain('Export collections');
    expect(html).toContain('Backend URL');
    expect(html).toContain('Format picker');
    expect(html).toContain('Include graph relationships');
    expect(html).toContain('Export and prepare download');
    expect(html).toContain('Export progress');
    expect(html).toContain('Export app guide');
    expect(html).toContain('dark:bg-surface');
  });
});
