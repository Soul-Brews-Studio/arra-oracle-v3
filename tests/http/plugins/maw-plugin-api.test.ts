import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { loadUnifiedPlugins } from '../../../src/plugins/unified-loader.ts';

const previousApi = process.env.ORACLE_API;

afterEach(() => {
  if (previousApi === undefined) delete process.env.ORACLE_API;
  else process.env.ORACLE_API = previousApi;
});

describe('maw-js ARRA plugin API surface', () => {
  test('invokes the modern manifest api surface through the shared CLI handler', async () => {
    const backend = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === '/api/health') return Response.json({ status: 'ok', version: 'test' });
        return Response.json({ error: 'missing' }, { status: 404 });
      },
    });
    process.env.ORACLE_API = String(backend.url);

    try {
      const runtime = await loadUnifiedPlugins({ dirs: [process.cwd()], warn: () => {} });
      const app = new Elysia();
      for (const route of runtime.routes) app.use(route as never);

      const res = await app.handle(new Request('http://local/api/arra?command=health'));
      const body = await res.json() as { ok: boolean; output?: string };

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.output).toContain('arra health: ok');
    } finally {
      backend.stop();
    }
  });
});
