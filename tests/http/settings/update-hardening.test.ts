import { afterAll, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = mkdtempSync(join(tmpdir(), 'settings-update-hardening-'));
const dbPath = join(root, 'oracle.db');
const restoreDbPath = savedDbPath
  ?? join(savedDataDir ?? join(process.env.HOME!, '.arra-oracle-v2'), 'oracle.db');
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { getScopedSetting, setScopedSetting } = await import('../../../src/db/scoped-settings.ts');
const { updateSettingsRoute } = await import('../../../src/routes/settings/update.ts');

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function postSettings(body: Record<string, unknown>): Promise<Response> {
  return updateSettingsRoute.handle(new Request('http://local/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  setScopedSetting('auth_password_hash', null);
  setScopedSetting('auth_enabled', null);
  setScopedSetting('auth_local_bypass', null);
});

afterAll(() => {
  dbMod.closeDb();
  restore('ORACLE_DATA_DIR', savedDataDir);
  restore('ORACLE_DB_PATH', savedDbPath);
  dbMod.resetDefaultDatabaseForTests(restoreDbPath);
  rmSync(root, { recursive: true, force: true });
});

test('POST /api/settings rejects blank new passwords without side effects', async () => {
  const res = await postSettings({ newPassword: '  ', authEnabled: true });
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: 'Password required' });
  expect(getScopedSetting('auth_password_hash')).toBeNull();
  expect(getScopedSetting('auth_enabled')).toBeNull();
});

test('POST /api/settings requires current password before removal', async () => {
  const hash = await Bun.password.hash('old-secret');
  setScopedSetting('auth_password_hash', hash);

  const res = await postSettings({ removePassword: true });
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: 'Current password required' });
  expect(await Bun.password.verify('old-secret', getScopedSetting('auth_password_hash')!)).toBe(true);
});

test('POST /api/settings rejects set-and-remove conflicts before mutation', async () => {
  setScopedSetting('auth_password_hash', await Bun.password.hash('old-secret'));
  setScopedSetting('auth_enabled', 'true');

  const res = await postSettings({
    newPassword: 'new-secret',
    removePassword: true,
    currentPassword: 'old-secret',
  });
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: 'Cannot set and remove password in the same request' });
  expect(await Bun.password.verify('old-secret', getScopedSetting('auth_password_hash')!)).toBe(true);
  expect(getScopedSetting('auth_enabled')).toBe('true');
});

test('POST /api/settings treats corrupt stored hashes as failed verification', async () => {
  setScopedSetting('auth_password_hash', 'not-a-valid-password-hash');

  const res = await postSettings({ newPassword: 'new-secret', currentPassword: 'old-secret' });
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({ error: 'Current password is incorrect' });
  expect(getScopedSetting('auth_password_hash')).toBe('not-a-valid-password-hash');
});
