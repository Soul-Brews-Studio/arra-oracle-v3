import { expect, test } from 'bun:test';
import { json, manifest, proxyApp } from './helpers.ts';

test('proxy manifest reports the missing target env var', async () => {
  const app = proxyApp(undefined, [{ ...manifest, methods: ['GET'] }]);

  const res = await app.handle(new Request('http://local/api/vector-db/items'));

  expect(res.status).toBe(502);
  expect(await json(res)).toMatchObject({ ok: false, targetEnv: 'TEST_VECTOR_DB_URL' });
});
