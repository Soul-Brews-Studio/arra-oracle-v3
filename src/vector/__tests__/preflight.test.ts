import { describe, expect, test } from 'bun:test';
import { preflightVectorRuntime } from '../preflight.ts';

const argv = ['bun', 'src/server.ts'];

describe('preflightVectorRuntime', () => {
  test('probes VECTOR_URL and marks proxied vector available', async () => {
    const seen: string[] = [];
    const result = await preflightVectorRuntime({
      env: { VECTOR_URL: 'http://vector.local:8081' },
      argv,
      fetcher: async (input) => {
        seen.push(String(input));
        return Response.json({ status: 'ok', protocol: 'vector-proxy-v1' });
      },
    });

    expect(seen).toEqual(['http://vector.local:8081/health']);
    expect(result).toMatchObject({
      vectorMode: 'proxied',
      vectorUrl: 'http://vector.local:8081',
      vectorAvailable: true,
      vectorServer: { status: 'ok', protocol: 'vector-proxy-v1' },
    });
  });

  test('keeps startup non-fatal and reports unavailable proxy', async () => {
    const warnings: string[] = [];
    const result = await preflightVectorRuntime({
      env: { VECTOR_URL: 'http://vector.local:8081' },
      argv,
      fetcher: async () => new Response('down', { status: 503 }),
      warn: (message) => warnings.push(message),
    });

    expect(result.vectorMode).toBe('proxied');
    expect(result.vectorAvailable).toBe(false);
    expect(result.vectorServer).toMatchObject({ status: 'down', httpStatus: 503 });
    expect(warnings[0]).toContain('VECTOR_URL preflight failed');
  });
});
