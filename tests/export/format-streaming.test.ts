import { describe, expect, test } from 'bun:test';

import {
  exportFormatInfo,
  getExportFormat,
  type EmbeddingDump,
} from '../../src/vector/export-formats.ts';

const decoder = new TextDecoder();

const dump: EmbeddingDump = {
  ids: ['doc-1', 'doc-2'],
  embeddings: [[0], [1]],
  documents: ['Alpha body', 'Bravo body'],
  metadatas: [
    { type: 'learning', source_file: 'notes/alpha.md', concepts: '["alpha","safe"]' },
    { type: 'trace', sourceFile: 'traces/bravo.md', concepts: ['bravo'] },
  ],
};

async function streamText(format: string, input: EmbeddingDump = dump): Promise<string> {
  const formatter = getExportFormat(format);
  if (!formatter) throw new Error(`missing formatter: ${format}`);
  return new Response(formatter(input)).text();
}

function guardedArray<T>(first: T): T[] {
  return new Proxy([first] as T[], {
    get(target, prop, receiver) {
      if (prop === 'length') return 2;
      if (String(prop) === '1') throw new Error('formatter eagerly read past first row');
      return Reflect.get(target, prop, receiver);
    },
  });
}

function guardedDump(): EmbeddingDump {
  return {
    ids: guardedArray('doc-1'),
    embeddings: [],
    documents: guardedArray('Alpha body'),
    metadatas: guardedArray({ type: 'learning', source_file: 'notes/alpha.md', concepts: 'alpha' }),
  };
}

describe('export format streaming', () => {
  test('built-in formatter registry exposes every supported format', () => {
    expect(['json', 'jsonl', 'csv', 'markdown', 'v2'].map((format) => exportFormatInfo(format)))
      .toEqual([
        { format: 'json', label: 'JSON', mimeType: 'application/json; charset=utf-8', extension: 'json' },
        { format: 'jsonl', label: 'JSONL', mimeType: 'application/x-ndjson; charset=utf-8', extension: 'jsonl' },
        { format: 'csv', label: 'CSV', mimeType: 'text/csv; charset=utf-8', extension: 'csv' },
        { format: 'markdown', label: 'Markdown', mimeType: 'text/markdown; charset=utf-8', extension: 'md' },
        { format: 'v2', label: 'V2', mimeType: 'application/json; charset=utf-8', extension: 'v2.json' },
      ]);
  });

  test('built-in formatters serialize non-empty dumps in all formats', async () => {
    expect(JSON.parse(await streamText('json'))).toEqual([
      { id: 'doc-1', document: 'Alpha body', type: 'learning', source_file: 'notes/alpha.md', concepts: ['alpha', 'safe'] },
      { id: 'doc-2', document: 'Bravo body', type: 'trace', source_file: 'traces/bravo.md', concepts: ['bravo'] },
    ]);
    expect((await streamText('jsonl')).trimEnd().split('\n')).toHaveLength(2);
    expect(await streamText('csv')).toContain('"doc-2","Bravo body","trace","traces/bravo.md","[""bravo""]"');
    expect(await streamText('markdown')).toContain('<!-- source: notes/alpha.md -->\n\nAlpha body');
    const v2 = JSON.parse(await streamText('v2')) as { version: number; documents: Array<Record<string, unknown>> };
    expect(v2.version).toBe(1);
    expect(v2.documents[0]).toMatchObject({ id: 'doc-1', content: 'Alpha body', source: 'notes/alpha.md' });
  });

  test('format streams can be cancelled before reading the full dump', async () => {
    for (const format of ['json', 'jsonl', 'csv', 'markdown', 'v2']) {
      const formatter = getExportFormat(format);
      if (!formatter) throw new Error(`missing formatter: ${format}`);
      const reader = formatter(guardedDump()).getReader();
      const first = await reader.read();
      expect(first.done).toBe(false);
      expect(decoder.decode(first.value)).not.toBe('');
      await reader.cancel();
    }
  });
});
