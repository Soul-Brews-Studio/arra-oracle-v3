import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-server-factory-'));
const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;
process.env.ORACLE_DATA_DIR = tmp;
process.env.ORACLE_DB_PATH = path.join(tmp, 'oracle.db');

const { createApp } = await import('../../server.ts');
const { loadUnifiedPlugins } = await import('../../plugins/unified-loader.ts');

describe('server app factory', () => {
  test('importing server.ts has no runnable server side effects', () => {
    expect(fs.existsSync(path.join(tmp, 'oracle-http.pid'))).toBe(false);
  });

  test('createApp builds routes without starting a listener', async () => {
    const unifiedPlugins = await loadUnifiedPlugins({ dirs: [] });
    const app = createApp({ unifiedPlugins, dataDir: tmp, vectorUrl: '' });
    const response = await app.handle(new Request('http://local/'));

    expect(response.status).toBe(200);
    expect((await response.json()).server).toBe('arra-oracle-v3');
    expect(fs.existsSync(path.join(tmp, 'oracle-http.pid'))).toBe(false);
  });
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = originalDataDir;
  if (originalDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = originalDbPath;
  fs.rmSync(tmp, { recursive: true, force: true });
});
