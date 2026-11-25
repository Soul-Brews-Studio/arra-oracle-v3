/** /api/federation refuses callers outside tailnet/LAN before anything else runs. */
import { beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PEER_IP_HEADER } from '../net.ts';

let hub: { handle(r: Request): Promise<Response> };
beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-hubpriv-'));
  process.env.ORACLE_DATA_DIR = dir;
  process.env.ORACLE_DB_PATH = path.join(dir, 'oracle.db');
  ({ hubRoutes: hub } = await import('../../routes/hub/index.ts'));
});

const call = (ip: string, p = '/api/federation/join', init: RequestInit = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"code":"X"}' }) => {
  const req = new Request(`http://local${p}`, init);
  req.headers.set(PEER_IP_HEADER, ip);
  return hub.handle(req);
};

describe('hub door: private addresses only', () => {
  test('a public address is refused with 403 on every door', async () => {
    for (const p of ['/api/federation/join', '/api/federation/hub', '/api/federation/vault']) {
      const res = await call('8.8.8.8', p, p === '/api/federation/join' ? undefined : {});
      expect(res.status).toBe(403);
    }
  });

  test('a tailnet address reaches the door (then the code or token decides)', async () => {
    const res = await call('100.88.1.2');
    expect(res.status).not.toBe(403);
  });
});
