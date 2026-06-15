import { expect, test } from 'bun:test';
import { json, proxyApp, startServer } from './helpers.ts';

test('proxy manifest passes through and strips public prefix', async () => {
  const target = startServer(async (req) => Response.json({
    method: req.method,
    path: new URL(req.url).pathname + new URL(req.url).search,
    body: await req.text(),
  }));
  const app = proxyApp(target);

  const res = await app.handle(new Request('http://local/api/vector-db/collections?q=one', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  }));

  expect(res.status).toBe(200);
  expect(res.headers.get('x-unified-proxy-target')).toBe(new URL(target).origin);
  expect(await json(res)).toEqual({
    method: 'POST',
    path: '/collections?q=one',
    body: JSON.stringify({ ok: true }),
  });
});
