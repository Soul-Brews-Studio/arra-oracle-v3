import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const doc = readFileSync('docs/memory-demo.md', 'utf8');

describe('memory demo docs', () => {
  test('walkthrough covers the #2251 runnable memory surfaces', () => {
    expect(doc).toContain('#2251');
    for (const phrase of [
      'provenance',
      'query-time confidence',
      'retrieval heat',
      'valid-time',
      'runConsolidationWorker',
      'deleted: 0',
    ]) expect(doc).toContain(phrase);
  });

  test('walkthrough includes copy-pasteable HTTP and Bun commands', () => {
    expect(doc).toContain('curl_json -X POST "$BASE/memory/save"');
    expect(doc).toContain('curl_json "$BASE/search?q=demoheatunique');
    expect(doc).toContain('bun --eval');
  });
});
