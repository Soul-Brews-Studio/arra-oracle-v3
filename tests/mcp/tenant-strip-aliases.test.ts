import { expect, test } from 'bun:test';
import { stripMcpTenantArgs, tenantIdFromMcpArgs } from '../../src/mcp/tenant.ts';

test('MCP tenant parser strips aliases and keeps normal args', () => {
  expect(tenantIdFromMcpArgs({ org_id: 'tenant-a', query: 'x' })).toBe('tenant-a');
  expect(stripMcpTenantArgs({ org_id: 'tenant-a', tenant: 'tenant-b', query: 'x' })).toEqual({ query: 'x' });
});
