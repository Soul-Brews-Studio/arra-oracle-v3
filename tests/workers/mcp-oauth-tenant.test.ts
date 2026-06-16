import { describe, expect, test } from 'bun:test';
import {
  resolveTenantIdForRequest,
  tenantIdFromAuthProps,
} from '../../workers/mcp/src/oauth-tenant.ts';

describe('MCP OAuth tenant claim extraction', () => {
  test('extracts tenant claims from workers-oauth-provider auth props', () => {
    expect(tenantIdFromAuthProps({ claims: { tenant_id: 'school-a' } }))
      .toBe('school-a');
    expect(tenantIdFromAuthProps({
      token: { 'https://arra-oracle.example/tenant_id': 'team:platform' },
    })).toBe('team:platform');
    expect(tenantIdFromAuthProps({ user: { organization: { id: 'company-1' } } }))
      .toBe('company-1');
  });

  test('prefers OAuth tenant claims over client-requested tenant ids', () => {
    expect(resolveTenantIdForRequest(
      { claims: { tenantId: 'tenant-from-token' } },
      'tenant-from-tool',
    )).toEqual({ tenantId: 'tenant-from-token', source: 'auth' });
  });

  test('keeps explicit tenant fallback for non-OAuth proxy smoke tests', () => {
    expect(resolveTenantIdForRequest(undefined, 'tenant-from-tool'))
      .toEqual({ tenantId: 'tenant-from-tool', source: 'tool' });
  });

  test('rejects authenticated calls without a usable tenant claim', () => {
    expect(resolveTenantIdForRequest({ claims: { sub: 'user-1' } }, 'tenant-a'))
      .toEqual({ source: 'none', error: 'OAuth token is missing a tenant claim.' });
    expect(resolveTenantIdForRequest({ claims: { tenant_id: '../bad' } }))
      .toEqual({ source: 'none', error: 'OAuth tenant claim is invalid.' });
  });
});
