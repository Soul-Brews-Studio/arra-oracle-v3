import { afterEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { settings } from '../../src/db/schema.ts';
import { closeTenantDbsForTests, getTenantDb } from '../../src/db/tenant.ts';

let tempDir = '';
const cwd = process.cwd();

afterEach(() => {
  closeTenantDbsForTests();
  process.chdir(cwd);
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  tempDir = '';
});

function root(): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-tenant-isolation-'));
  return tempDir;
}

describe('tenant storage isolation', () => {
  test('keeps same setting keys isolated across tenant databases', () => {
    const dataDir = root();
    const alpha = getTenantDb('alpha', { dataDir });
    const beta = getTenantDb('beta', { dataDir });

    alpha.db.insert(settings)
      .values({ key: 'shared-key', value: 'alpha-value', updatedAt: 1 }).run();
    beta.db.insert(settings)
      .values({ key: 'shared-key', value: 'beta-value', updatedAt: 1 }).run();

    expect(alpha.db.select().from(settings).where(eq(settings.key, 'shared-key')).get()?.value).toBe('alpha-value');
    expect(beta.db.select().from(settings).where(eq(settings.key, 'shared-key')).get()?.value).toBe('beta-value');
    expect(alpha.dbPath).not.toBe(beta.dbPath);
  });

  test('normalizes relative data dirs to one cached tenant handle', () => {
    const dataDir = root();
    const parent = path.dirname(dataDir);
    const relative = path.basename(dataDir);
    process.chdir(parent);

    const fromRelative = getTenantDb('same-tenant', { dataDir: relative });
    const fromAbsolute = getTenantDb('same-tenant', { dataDir });

    expect(fromRelative).toBe(fromAbsolute);
    expect(fromRelative.dbPath).toBe(path.join(fs.realpathSync(dataDir), 'tenants', 'same-tenant', 'oracle.db'));
  });
});
