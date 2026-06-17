import { afterEach, expect, test } from 'bun:test';
import { proxyToolCall } from '../../src/mcp/http-proxy.ts';
import { tenantIdFromMcpArgs } from '../../src/mcp/tenant.ts';
import { TENANT_HEADER } from '../../src/middleware/tenant.ts';
import { captureProxyRequest } from './support/http-proxy.ts';

afterEach(() => {
  delete process.env.ORACLE_TENANT_ID;
  delete process.env.ORACLE_TENANT;
});

test('MCP tenant parser falls back to env only when explicit tenant hints are blank', () => {
  process.env.ORACLE_TENANT_ID = 'env-tenant';
  expect(tenantIdFromMcpArgs({ tenantId: '   ', tenant: '' })).toBe('env-tenant');
  expect(() => tenantIdFromMcpArgs({ tenantId: 'bad tenant' })).toThrow('invalid tenant id');
});

test('HTTP proxy accepts tenant alias args and strips them from query params', async () => {
  const captured = await captureProxyRequest('oracle_search', {
    query: 'proxy tenant edge',
    org_id: 'tenant-from-org',
    tenant: 'ignored-lower-priority',
  });

  expect(captured).toMatchObject({
    method: 'GET',
    path: '/api/search',
    query: { q: 'proxy tenant edge' },
    headers: { [TENANT_HEADER.toLowerCase()]: 'ignored-lower-priority' },
  });
});

test('HTTP proxy validates explicit tenant hints even when base URL is embedded', async () => {
  await expect(proxyToolCall(null, 'oracle_search', { query: 'x', tenantId: 'bad tenant' })).rejects.toThrow('invalid tenant id');
});
