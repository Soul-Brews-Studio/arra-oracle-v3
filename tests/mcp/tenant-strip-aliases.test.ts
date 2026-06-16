import { expect, test } from 'bun:test';
import { mcpTenantHeaders, stripMcpTenantArgs, tenantIdFromMcpArgs } from '../../src/mcp/tenant.ts';
import { TENANT_HEADER } from '../../src/middleware/tenant.ts';

test('MCP tenant parser strips aliases and keeps normal args', () => {
  expect(tenantIdFromMcpArgs({ org_id: 'tenant-a', query: 'x' })).toBe('tenant-a');
  expect(stripMcpTenantArgs({ org_id: 'tenant-a', tenant: 'tenant-b', query: 'x' })).toEqual({ query: 'x' });
});

test('MCP tenant headers trim and validate tenant context values', () => {
  expect(mcpTenantHeaders(' tenant-a ')).toEqual({ [TENANT_HEADER]: 'tenant-a' });
  expect(mcpTenantHeaders('   ')).toEqual({});
  expect(() => mcpTenantHeaders('bad tenant')).toThrow('invalid tenant id');
});
