import { eq } from 'drizzle-orm';
import { currentTenantId, tenantDataPath } from '../../middleware/tenant.ts';

type TenantColumnTable = { tenantId?: unknown };

export function currentExportTenantId(): string | undefined {
  return currentTenantId();
}

export function canReadTenantResource(resourceTenantId?: string | null): boolean {
  const tenantId = currentTenantId();
  return !tenantId || resourceTenantId === tenantId;
}

export function tenantScopedOutputDir(outputDir: string): string {
  return currentTenantId() ? tenantDataPath(outputDir) : outputDir;
}

export function tenantWhereFor(table: unknown) {
  const tenantId = currentTenantId();
  const column = (table as TenantColumnTable).tenantId;
  return tenantId && column ? eq(column as never, tenantId) : undefined;
}
