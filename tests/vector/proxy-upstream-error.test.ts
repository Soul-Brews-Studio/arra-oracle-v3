import { expect, test } from 'bun:test';
import { json, proxyApp } from './helpers.ts';

test('proxy manifest returns bad gateway when the sidecar is unreachable', async () => {
  const app = proxyApp('http://127.0.0.1:1');

  const res = await app.handle(new Request('http://local/api/vector-db/items'));

  expect(res.status).toBe(502);
  expect((await json(res)).ok).toBe(false);
});
