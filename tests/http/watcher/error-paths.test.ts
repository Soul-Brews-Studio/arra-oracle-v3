import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createWatcherRoutes } from '../../../src/routes/watcher/index.ts';

function throwingService(message: string) {
  const fail = () => { throw new Error(message); };
  return { status: fail, start: fail, stop: fail };
}

async function call(pathname: string, method = 'GET') {
  const app = new Elysia().use(createWatcherRoutes(throwingService(`${method} boom`) as any));
  const res = await app.handle(new Request(`http://local${pathname}`, { method }));
  return { status: res.status, body: await res.json() as { error: string } };
}

describe('watcher HTTP error paths', () => {
  test('returns structured 500s when watcher status throws', async () => {
    const res = await call('/api/watcher/status');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('GET boom');
  });

  test('returns structured 500s when watcher start throws', async () => {
    const res = await call('/api/watcher/start', 'POST');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('POST boom');
  });

  test('returns structured 500s when watcher stop throws', async () => {
    const res = await call('/api/watcher/stop', 'POST');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('POST boom');
  });
});
