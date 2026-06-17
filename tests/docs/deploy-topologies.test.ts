import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('deploy topologies architecture guide', () => {
  test('documents the required topology options', () => {
    const doc = read('docs/architecture/deploy-topologies.md');

    for (const option of [
      'All-local',
      'CF Workers edge + local backend',
      'Vercel frontend + backend URL',
      'Federation tunnel',
    ]) expect(doc).toContain(option);
  });

  test('captures when-to-use guidance and boundary knobs', () => {
    const doc = read('docs/architecture/deploy-topologies.md');

    for (const phrase of [
      'Use this when',
      'maw arra serve --port 47778',
      'ORACLE_PROXY_VECTOR_URL',
      'ORACLE_URL',
      'TUNNEL_URL',
      'FEDERATION_TOKEN',
    ]) expect(doc).toContain(phrase);
  });

  test('docs index links the deploy topologies guide', () => {
    const index = read('docs/README.md');

    expect(index).toContain('[architecture/deploy-topologies.md](./architecture/deploy-topologies.md)');
  });
});
