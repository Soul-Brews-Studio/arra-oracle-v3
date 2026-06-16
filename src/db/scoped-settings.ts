import { eq } from 'drizzle-orm';
import { db, settings } from './index.ts';
import { currentTenantId, DEFAULT_TENANT_ID } from '../middleware/tenant.ts';

function encodeTenantSegment(tenantId: string): string {
  return Buffer.from(tenantId, 'utf8').toString('base64url');
}

export function scopedSettingKey(key: string, tenantId = currentTenantId()): string {
  if (!tenantId || tenantId === DEFAULT_TENANT_ID) return key;
  return `tenant:${encodeTenantSegment(tenantId)}:${key}`;
}

export function getScopedSetting(key: string): string | null {
  const row = db.select()
    .from(settings)
    .where(eq(settings.key, scopedSettingKey(key)))
    .get();
  return row?.value ?? null;
}

export function setScopedSetting(key: string, value: string | null): void {
  const settingKey = scopedSettingKey(key);
  db.insert(settings)
    .values({ key: settingKey, value, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: Date.now() },
    })
    .run();
}
