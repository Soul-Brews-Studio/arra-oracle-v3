import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('modular backend architecture doc', () => {
  test('captures the four-layer target architecture', () => {
    const doc = read('docs/architecture/modular-backend.md');

    expect(doc).toContain('```mermaid');
    expect(doc).toContain('Layer 1: CF Workers edge');
    expect(doc).toContain('Layer 2: maw arra plugin backend');
    expect(doc).toContain('Layer 3: vector server');
    expect(doc).toContain('Layer 4: MCP plugin packages');
  });

  test('locks the key contracts and operator entrypoint', () => {
    const doc = read('docs/architecture/modular-backend.md');

    for (const phrase of [
      'maw arra serve --port 47778',
      'ORACLE_PROXY_VECTOR_URL',
      'POST   /vectors/query',
      'InvokeContext',
      'Workers -> backend -> vector server -> plugin MCP',
    ]) expect(doc).toContain(phrase);
  });

  test('docs index links the modular backend guide', () => {
    const index = read('docs/README.md');

    expect(index).toContain('[architecture/modular-backend.md](./architecture/modular-backend.md)');
  });
});
