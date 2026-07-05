import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseConnection } from './index.ts';
import { createDatabase } from './index.ts';
import { ORACLE_DATA_DIR } from '../config.ts';

const DEFAULT_TENANT_ID = 'default';
const TENANT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export interface TenantDatabaseConnection extends DatabaseConnection {
  tenantId: string;
  dbPath: string;
  close(): void;
}

export interface GetTenantDbOptions {
  dataDir?: string;
}

const connections = new Map<string, TenantDatabaseConnection>();

export function getTenantDb(
  tenantId: string,
  options: GetTenantDbOptions = {},
): TenantDatabaseConnection {
  const normalizedTenant = normalizeTenantId(tenantId);
  const dbPath = tenantDbPath(normalizedTenant, options.dataDir);
  const cached = connections.get(dbPath);
  if (cached) return cached;

  const connection = createDatabase(dbPath);
  const tenantConnection: TenantDatabaseConnection = {
    ...connection,
    tenantId: normalizedTenant,
    dbPath,
    close() {
      connections.delete(dbPath);
      connection.storage.close();
    },
  };
  connections.set(dbPath, tenantConnection);
  return tenantConnection;
}

export function closeTenantDbsForTests(): void {
  for (const connection of connections.values()) {
    try { connection.storage.close(); } catch {}
  }
  connections.clear();
}

function tenantDbPath(tenantId: string, dataDir = ORACLE_DATA_DIR): string {
  const input = dataDir.trim() || ORACLE_DATA_DIR;
  const root = fs.existsSync(input) ? fs.realpathSync(input) : path.resolve(input);
  return path.join(root, 'tenants', tenantId, 'oracle.db');
}

function normalizeTenantId(tenantId: string): string {
  const trimmed = typeof tenantId === 'string' ? tenantId.trim() : '';
  const normalized = trimmed || DEFAULT_TENANT_ID;
  if (!TENANT_PATTERN.test(normalized)) throw new Error('invalid tenant id');
  return normalized;
}
