import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('MCP remote transport docs', () => {
  test('documents the Worker /mcp and mcp-remote contract', () => {
    const doc = read('docs/architecture/mcp-remote-transport.md');

    expect(doc).toContain('workers/mcp /mcp');
    expect(doc).toContain('mcp-remote');
    expect(doc).toContain('https://<worker-name>.<account>.workers.dev/mcp');
    expect(doc).toContain('remoteable: true');
    expect(doc).toContain('src/tools/mcp-rest-map.ts');
    expect(doc).toContain('must not import `src/tools/mcp-manifest.ts`');
  });

  test('links the transport contract from the docs index', () => {
    expect(read('docs/README.md')).toContain('architecture/mcp-remote-transport.md');
  });
});
