import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('cloudflared origin contract doc', () => {
  test('documents the production Worker origin secret and tunnel contract', () => {
    const doc = read('docs/architecture/cloudflared-origin-contract.md');

    for (const phrase of [
      'ORACLE_ORIGIN_URL',
      'wrangler secret put ORACLE_ORIGIN_URL',
      'cloudflared tunnel --url http://127.0.0.1:47778',
      'GET /api/health',
      'TUNNEL_URL',
    ]) expect(doc).toContain(phrase);
  });

  test('links the origin contract from the docs index', () => {
    const index = read('docs/README.md');

    expect(index).toContain('[architecture/cloudflared-origin-contract.md](./architecture/cloudflared-origin-contract.md)');
  });
});
