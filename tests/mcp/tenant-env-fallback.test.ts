import { expect, test } from 'bun:test';
import { TENANT_HEADER } from '../../src/middleware/tenant.ts';
import { mcpTenantHeaders, tenantIdFromMcpArgs } from '../../src/mcp/tenant.ts';

test('MCP tenant parser falls back to environment tenant hints and emits headers', () => {
  const previous = {
    ORACLE_TENANT_ID: process.env.ORACLE_TENANT_ID,
    ORACLE_TENANT: process.env.ORACLE_TENANT,
  };
  try {
    process.env.ORACLE_TENANT_ID = 'tenant-env';
    process.env.ORACLE_TENANT = 'tenant-secondary';

    expect(tenantIdFromMcpArgs({ tenantId: ' ', query: 'x' })).toBe('tenant-env');
    expect(mcpTenantHeaders('tenant-env')).toEqual({ [TENANT_HEADER]: 'tenant-env' });
    expect(mcpTenantHeaders(undefined)).toEqual({});
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
