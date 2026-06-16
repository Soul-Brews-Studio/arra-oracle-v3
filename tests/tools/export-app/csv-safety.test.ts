import { expect, test } from 'bun:test';
import { formatCsvCollection } from '../../../tools/export-app/format-csv.ts';
import { formatDocumentsCsv } from '../../../tools/export-app/document-csv.ts';

test('collection CSV escapes spreadsheet formula prefixes', () => {
  const csv = formatCsvCollection('oracle_documents', [{
    id: '=cmd',
    title: '+title',
    content: '@body',
    createdAt: '-1',
  }]);

  expect(csv).toContain('"\'=cmd"');
  expect(csv).toContain(`"'+title"`);
  expect(csv).toContain('"\'@body"');
  expect(csv).toContain('"\'-1"');
});

test('document CSV escapes spreadsheet formula prefixes', () => {
  const csv = formatDocumentsCsv([{
    id: '=doc',
    source: '+source.md',
    content: '@content',
    concepts: ['-concept'],
    metadata: { type: '=learning' },
  }]);

  expect(csv).toContain('"\'=doc"');
  expect(csv).toContain(`"'+source.md"`);
  expect(csv).toContain('"\'@content"');
  expect(csv).toContain('"\'-concept"');
});
