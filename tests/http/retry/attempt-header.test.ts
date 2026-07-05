import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { proxyToService } from '../../../src/gateway/proxy.ts';
import { UPSTREAM_RETRY_ATTEMPTS_HEADER, retryUpstreamRequest } from '../../../src/middleware/retry.ts';
import { proxyRequestForManifest } from '../../../src/plugins/proxy-surface.ts';

const manifest = { path: '/api/retry', targetEnv: 'TEST_RETRY_URL', stripPrefix: true, methods: ['GET'] };
const servers: ReturnType<typeof Bun.serve>[] = [];

function startServer(handler: () => Response): string {
  const server = Bun.serve({ port: 0, fetch: handler });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

function stopServers() {
  while (servers.length) servers.pop()!.stop();
}

function proxyApp(target: string) {
  return new Elysia().onRequest(({ request }) => proxyRequestForManifest(request, [manifest], { TEST_RETRY_URL: target }));
}

async function json(response: Response) {
  return await response.json() as Record<string, unknown>;
}

describe('upstream retry attempt header', () => {
  test('reports retry attempts on unified proxy, gateway proxy, and direct retry responses', async () => {
    try {
      let unifiedAttempts = 0;
      const unifiedTarget = startServer(() => {
        unifiedAttempts += 1;
        return unifiedAttempts < 3
          ? Response.json({ unifiedAttempts }, { status: 503 })
          : Response.json({ unifiedAttempts });
      });

      const unified = await proxyApp(unifiedTarget).handle(new Request('http://local/api/retry/status'));
      expect(unified.headers.get(UPSTREAM_RETRY_ATTEMPTS_HEADER)).toBe('2');
      expect(await json(unified)).toEqual({ unifiedAttempts: 3 });

      let gatewayAttempts = 0;
      const gatewayTarget = startServer(() => {
        gatewayAttempts += 1;
        return gatewayAttempts === 1 ? new Response('busy', { status: 500 }) : Response.json({ gatewayAttempts });
      });

      const gateway = await proxyToService(new Request('http://local/api/search'), { url: gatewayTarget, timeout: 500 });
      expect(gateway.headers.get(UPSTREAM_RETRY_ATTEMPTS_HEADER)).toBe('1');
      expect(await json(gateway)).toEqual({ gatewayAttempts: 2 });

      const direct = await retryUpstreamRequest(async () => Response.json({ ok: true }), { maxRetries: 2 });
      expect(direct.headers.get(UPSTREAM_RETRY_ATTEMPTS_HEADER)).toBe('0');
      expect(await json(direct)).toEqual({ ok: true });
    } finally {
      stopServers();
    }
  });
});
