import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { proxyToService } from '../../../src/gateway/proxy.ts';
import {
  isRetryableUpstreamStatus,
  retryCountFromEnv,
  retryUpstreamRequest,
} from '../../../src/middleware/retry.ts';
import { proxyRequestForManifest } from '../../../src/plugins/proxy-surface.ts';

const previousRetryCount = process.env.ARRA_RETRY_COUNT;
const manifest = { path: '/api/retry', targetEnv: 'TEST_RETRY_URL', stripPrefix: true, methods: ['GET', 'POST'] };
const servers: ReturnType<typeof Bun.serve>[] = [];

afterEach(() => {
  if (previousRetryCount === undefined) delete process.env.ARRA_RETRY_COUNT;
  else process.env.ARRA_RETRY_COUNT = previousRetryCount;
  while (servers.length) servers.pop()!.stop();
});

function startServer(handler: (request: Request) => Response | Promise<Response>): string {
  const server = Bun.serve({ port: 0, fetch: handler });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

function proxyApp(target: string) {
  return new Elysia().onRequest(({ request }) => proxyRequestForManifest(request, [manifest], { TEST_RETRY_URL: target }));
}

async function json(response: Response) {
  return await response.json() as Record<string, unknown>;
}

describe('upstream proxy retry middleware', () => {
  test('retries failed unified proxy responses with the default retry count', async () => {
    let attempts = 0;
    const target = startServer(async (request) => {
      attempts += 1;
      if (attempts < 3) return Response.json({ attempts }, { status: 503 });
      return Response.json({ attempts, method: request.method, body: await request.text() });
    });
    const app = proxyApp(target);

    const response = await app.handle(new Request('http://local/api/retry/echo', {
      method: 'POST',
      body: 'payload',
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-unified-proxy-target')).toBe(new URL(target).origin);
    expect(await json(response)).toEqual({ attempts: 3, method: 'POST', body: 'payload' });
  });

  test('honors ARRA_RETRY_COUNT=0 for upstream proxy responses', async () => {
    process.env.ARRA_RETRY_COUNT = '0';
    let attempts = 0;
    const target = startServer(() => {
      attempts += 1;
      return Response.json({ attempts }, { status: 503 });
    });
    const app = proxyApp(target);

    const response = await app.handle(new Request('http://local/api/retry/down'));

    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({ attempts: 1 });
    expect(attempts).toBe(1);
  });

  test('retries gateway proxy failures before returning success', async () => {
    let attempts = 0;
    const target = startServer(() => {
      attempts += 1;
      return attempts === 1 ? new Response('busy', { status: 500 }) : Response.json({ attempts });
    });

    const response = await proxyToService(new Request('http://local/api/search?q=retry'), { url: target, timeout: 500 });

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Gateway-Service')).toBe(target);
    expect(await json(response)).toEqual({ attempts: 2 });
  });

  test('retries thrown attempts and then rethrows after the retry budget', async () => {
    let recoveredAttempts = 0;
    const recovered = await retryUpstreamRequest(async () => {
      recoveredAttempts += 1;
      if (recoveredAttempts < 3) throw new Error('temporary upstream failure');
      return Response.json({ ok: true });
    }, { maxRetries: 2 });

    let failedAttempts = 0;
    await expect(retryUpstreamRequest(async () => {
      failedAttempts += 1;
      throw new Error('upstream down');
    }, { maxRetries: 1 })).rejects.toThrow('upstream down');

    expect(await json(recovered)).toEqual({ ok: true });
    expect(recoveredAttempts).toBe(3);
    expect(failedAttempts).toBe(2);
  });

  test('parses retry counts and supports custom response retry predicates', async () => {
    const statuses = [418, 200];
    const response = await retryUpstreamRequest(async () => new Response('ok', { status: statuses.shift() }), {
      maxRetries: 1,
      shouldRetryResponse: (candidate) => candidate.status === 418,
    });

    expect(response.status).toBe(200);
    expect(retryCountFromEnv(undefined)).toBe(2);
    expect(retryCountFromEnv('3.9')).toBe(3);
    expect(retryCountFromEnv('-1')).toBe(2);
    expect(retryCountFromEnv('invalid')).toBe(2);
    let cancelAttempts = 0;
    const cancelResponse = await retryUpstreamRequest(async () => {
      cancelAttempts += 1;
      if (cancelAttempts === 1) {
        return new Response(new ReadableStream({ cancel: () => { throw new Error('ignore cancel'); } }), { status: 503 });
      }
      return new Response('recovered');
    }, { maxRetries: 1 });

    expect(await cancelResponse.text()).toBe('recovered');
    expect(isRetryableUpstreamStatus(500)).toBe(true);
    expect(isRetryableUpstreamStatus(418)).toBe(false);
  });
});
