import { afterEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { closeTenantDbsForTests, getTenantDb } from '../../src/db/tenant.ts';

let tempDir = '';

afterEach(() => {
  closeTenantDbsForTests();
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  tempDir = '';
});

test('tenant database falls back to default tenant for malformed runtime ids', () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-tenant-db-edge-'));

  const connection = getTenantDb(undefined as never, { dataDir: tempDir });

  expect(connection.tenantId).toBe('default');
  expect(connection.dbPath).toBe(path.join(tempDir, 'tenants', 'default', 'oracle.db'));
});

test('tenant database rejects path-like tenant ids before opening sqlite', () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-tenant-db-edge-'));

  expect(() => getTenantDb('../escape', { dataDir: tempDir })).toThrow('invalid tenant id');
  expect(fs.existsSync(path.join(tempDir, 'tenants'))).toBe(false);
});
