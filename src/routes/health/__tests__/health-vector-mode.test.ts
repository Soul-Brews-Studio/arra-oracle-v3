import { describe, expect, test } from 'bun:test';
import { healthEndpoint } from '../health.ts';

describe('/api/health vector mode', () => {
  test('includes vector runtime mode in health payload', async () => {
    const res = await healthEndpoint.handle(new Request('http://localhost/health'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(['embedded', 'proxied', 'disabled']).toContain(body.vectorMode);
  });
});
