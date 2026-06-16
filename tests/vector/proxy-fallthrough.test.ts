import { expect, test } from 'bun:test';
import { json, proxyApp } from './helpers.ts';

test('proxy manifest leaves non-matching paths for local routes', async () => {
  const app = proxyApp('http://127.0.0.1:1');

  const res = await app.handle(new Request('http://local/api/health'));

  expect(res.status).toBe(200);
  expect(await json(res)).toEqual({ ok: true });
});
