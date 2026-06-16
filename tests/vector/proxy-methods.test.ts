import { expect, test } from 'bun:test';
import { manifest, proxyApp } from './helpers.ts';

test('proxy manifest rejects methods outside the allowlist', async () => {
  const app = proxyApp(undefined, [{ ...manifest, methods: ['GET'] }]);

  const res = await app.handle(new Request('http://local/api/vector-db/items', { method: 'POST' }));

  expect(res.status).toBe(405);
  expect(res.headers.get('allow')).toBe('GET');
});
