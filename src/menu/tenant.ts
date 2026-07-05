import { and, eq, or, type SQL } from 'drizzle-orm';
import { menuItems } from '../db/index.ts';
import {
  currentTenantId,
  DEFAULT_TENANT_ID,
  tenantIdForWrite,
} from '../middleware/tenant.ts';

function combineWhere(...conditions: Array<SQL | undefined>): SQL | undefined {
  const active = conditions.filter((condition): condition is SQL => condition !== undefined);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return and(...active);
}

function sharedRouteWhere(): SQL | undefined {
  return and(eq(menuItems.tenantId, DEFAULT_TENANT_ID), eq(menuItems.source, 'route'));
}

export function menuTenantIdForWrite(): string {
  return tenantIdForWrite();
}

export function menuSettingKey(key: string): string {
  const tenantId = currentTenantId();
  return tenantId && tenantId !== DEFAULT_TENANT_ID ? `tenant:${tenantId}:${key}` : key;
}

export function menuSourceStateKey(): string {
  const tenantId = currentTenantId();
  return tenantId && tenantId !== DEFAULT_TENANT_ID ? tenantId : DEFAULT_TENANT_ID;
}

export function menuVisibleWhere(base?: SQL): SQL | undefined {
  const tenantId = currentTenantId();
  if (!tenantId) return base;
  return combineWhere(
    base,
    or(eq(menuItems.tenantId, tenantId), sharedRouteWhere()),
  );
}

export function menuOwnedWhere(base?: SQL): SQL | undefined {
  const tenantId = currentTenantId();
  return combineWhere(base, tenantId ? eq(menuItems.tenantId, tenantId) : undefined);
}
