import { describe, expect, it } from 'bun:test';

import { proxyToService } from '../proxy.ts';
import { LEGACY_TENANT_HEADER, runWithTenant, TENANT_HEADER } from '../../middleware/tenant.ts';

const servers: ReturnType<typeof Bun.serve>[] = [];

type CapturedRequest = {
  path: string;
  tenant: string | null;
};

function startCaptureServer(captured: CapturedRequest[]): string {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url);
      captured.push({
        path: `${url.pathname}${url.search}`,
        tenant: request.headers.get(TENANT_HEADER),
      });
      return Response.json({ ok: true });
    },
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

function stopServers(): void {
  while (servers.length) servers.pop()!.stop();
}

describe('gateway tenant proxying', () => {
  it('forwards active tenant context to upstream services', async () => {
    const captured: CapturedRequest[] = [];
    const target = startCaptureServer(captured);

    try {
      const response = await runWithTenant('tenant-gateway-a', () => (
        proxyToService(new Request('http://local/api/search?q=tenant'), { url: target, timeout: 500 })
      ));

      expect(response.status).toBe(200);
      expect(captured).toEqual([{ path: '/api/search?q=tenant', tenant: 'tenant-gateway-a' }]);
    } finally {
      stopServers();
    }
  });

  it('normalizes header-derived tenant ids to the canonical upstream header', async () => {
    const captured: CapturedRequest[] = [];
    const target = startCaptureServer(captured);

    try {
      const response = await proxyToService(
        new Request('http://local/api/map', { headers: { [LEGACY_TENANT_HEADER]: 'tenant-legacy' } }),
        { url: target, timeout: 500 },
      );

      expect(response.status).toBe(200);
      expect(captured).toEqual([{ path: '/api/map', tenant: 'tenant-legacy' }]);
    } finally {
      stopServers();
    }
  });
});
