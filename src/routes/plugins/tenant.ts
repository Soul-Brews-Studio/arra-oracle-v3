import { currentTenantId, tenantDataPath } from '../../middleware/tenant.ts';

export function tenantScopedPluginDir(dir: string): string {
  return tenantDataPath(dir);
}

export function tenantScopedPluginDirs(dirs: string[]): string[] {
  return dirs.map(tenantScopedPluginDir);
}

export function hasTenantPluginScope(): boolean {
  return Boolean(currentTenantId());
}
