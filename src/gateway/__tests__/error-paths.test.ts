import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { gatewayPlugin } from '../index.ts';
import { registerHook } from '../hooks.ts';

const REQUEST_HOOK = 'test-hardening-request-throws';
const ERROR_HOOK = 'test-hardening-error-throws';

registerHook({
  name: REQUEST_HOOK,
  phase: 'onRequest',
  handler: () => { throw new Error('request hook failed'); },
});

registerHook({
  name: ERROR_HOOK,
  phase: 'onError',
  handler: () => { throw new Error('error hook failed'); },
});

describe('gateway plugin error paths', () => {
  test('returns structured JSON when the configured error hook also throws', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-gateway-error-'));
    const savedHotReload = process.env.ORACLE_GATEWAY_HOT_RELOAD;
    process.env.ORACLE_GATEWAY_HOT_RELOAD = '0';
    try {
      fs.writeFileSync(path.join(dir, 'oracle-gateway.json'), JSON.stringify({
        services: { upstream: { url: 'http://127.0.0.1:9', timeout: 10 } },
        routes: [{ match: '/api/boom', service: 'upstream', fallback: 'error' }],
        hooks: { onRequest: [REQUEST_HOOK], onError: [ERROR_HOOK] },
      }));

      const app = new Elysia().use(gatewayPlugin(dir));
      const res = await app.handle(new Request('http://localhost/api/boom'));

      expect(res.status).toBe(502);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual({
        error: 'Gateway error handler failed',
        gateway: true,
      });
    } finally {
      restoreHotReload(savedHotReload);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

function restoreHotReload(value: string | undefined) {
  if (value === undefined) delete process.env.ORACLE_GATEWAY_HOT_RELOAD;
  else process.env.ORACLE_GATEWAY_HOT_RELOAD = value;
}
