import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createSmokeEnv, removeSmokeEnv, startVectorStub } from './_helpers.ts';

test('smoke env cleanup is idempotent and leaves no temp tree behind', () => {
  const smoke = createSmokeEnv('helper-cleanup');
  expect(existsSync(join(smoke.repoRoot, 'ψ'))).toBe(true);
  expect(smoke.env.ORACLE_API_TOKEN).toBe('');
  expect(smoke.env.ORACLE_EMBEDDER).toBe('none');

  removeSmokeEnv(smoke.root);
  expect(existsSync(smoke.root)).toBe(false);
  expect(() => removeSmokeEnv(smoke.root)).not.toThrow();
});

test('vector stub records requests and returns JSON 404s for unknown routes', async () => {
  const stub = startVectorStub((url) => ({ query: url.searchParams.get('q'), results: [] }));
  try {
    const missing = await fetch(`${stub.url}/api/unknown`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not found' });

    const search = await fetch(`${stub.url}/api/search?q=smoke`);
    expect(search.status).toBe(200);
    expect(await search.json()).toEqual({ query: 'smoke', results: [] });
    expect(stub.requests.map((url) => url.pathname)).toEqual(['/api/unknown', '/api/search']);
  } finally {
    await stub.stop();
  }
});
