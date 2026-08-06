import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = mkdtempSync(join(tmpdir(), 'auth-login-hardening-'));
const dbPath = join(root, 'oracle.db');
const restoreDbPath = savedDbPath
  ?? join(savedDataDir ?? join(process.env.HOME!, '.arra-oracle-v2'), 'oracle.db');
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { setScopedSetting } = await import('../../../src/db/scoped-settings.ts');
const { authRoutes, isLocalIp } = await import('../../../src/routes/auth/index.ts');

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function login(body: Record<string, unknown>): Promise<Response> {
  return authRoutes.handle(new Request('http://local/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

afterAll(() => {
  dbMod.closeDb();
  restore('ORACLE_DATA_DIR', savedDataDir);
  restore('ORACLE_DB_PATH', savedDbPath);
  dbMod.resetDefaultDatabaseForTests(restoreDbPath);
  rmSync(root, { recursive: true, force: true });
});

test('POST /api/auth/login rejects whitespace-only passwords before verification', async () => {
  setScopedSetting('auth_password_hash', await Bun.password.hash('secret'));

  const res = await login({ password: '   \t' });
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ success: false, error: 'Password required' });
});

test('POST /api/auth/login treats corrupt stored hashes as auth failure', async () => {
  setScopedSetting('auth_password_hash', 'not-a-valid-password-hash');

  const res = await login({ password: 'secret' });
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({ success: false, error: 'Invalid password' });
});

test('isLocalIp recognizes IPv4-mapped local addresses narrowly', () => {
  expect(isLocalIp(' ::ffff:127.0.0.1 ')).toBe(true);
  expect(isLocalIp('::ffff:10.2.3.4')).toBe(true);
  expect(isLocalIp('172.31.255.255')).toBe(true);
  expect(isLocalIp('172.32.0.1')).toBe(false);
  expect(isLocalIp('::ffff:8.8.8.8')).toBe(false);
});
