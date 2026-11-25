/** /mcp over HTTP: X-Oracle-Tenant reaches the tool call (it was ignored, so tenants got default rows, #3110). */
import { expect, test } from 'bun:test';
import { headerTenant, tenantIdFromMcpArgs } from '../tenant.ts';

test('the request header names the tenant when no tenant arg is given', () => {
  expect(tenantIdFromMcpArgs({ query: 'x' }, headerTenant({ 'x-oracle-tenant': 'neo' }))).toBe('neo');
});

test('an explicit tenant arg still wins over the header', () => {
  expect(tenantIdFromMcpArgs({ tenant: 'pulse' }, headerTenant({ 'x-oracle-tenant': 'neo' }))).toBe('pulse');
});

test('no arg and no header: no tenant (unless the env sets one)', () => {
  const saved = [process.env.ORACLE_TENANT_ID, process.env.ORACLE_TENANT];
  delete process.env.ORACLE_TENANT_ID; delete process.env.ORACLE_TENANT;
  try { expect(tenantIdFromMcpArgs({}, headerTenant({}))).toBeUndefined(); }
  finally { if (saved[0] !== undefined) process.env.ORACLE_TENANT_ID = saved[0]; if (saved[1] !== undefined) process.env.ORACLE_TENANT = saved[1]; }
});
