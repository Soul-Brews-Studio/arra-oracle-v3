import { expect, test } from 'bun:test';
import { tenantIdFromMcpArgs } from '../../src/mcp/tenant.ts';

test('MCP tenant parser rejects invalid explicit tenant ids', () => {
  expect(() => tenantIdFromMcpArgs({ tenantId: 'bad tenant' })).toThrow('invalid tenant id');
});
