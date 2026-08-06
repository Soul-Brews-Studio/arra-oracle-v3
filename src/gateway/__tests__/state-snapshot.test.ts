import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { gatewayPlugin } from '../index.ts';
import { registerHook, type GatewayContext } from '../hooks.ts';

const PAUSE_HOOK = 'test-gateway-snapshot-pause';
const OLD_RESPONSE_HOOK = 'test-gateway-snapshot-old';
const NEW_RESPONSE_HOOK = 'test-gateway-snapshot-new';

let pause: { entered: () => void; wait: Promise<void> } | undefined;

registerHook({
  name: PAUSE_HOOK,
  phase: 'onRequest',
  handler: async () => {
    pause?.entered();
    await pause?.wait;
  },
});

function tagResponse(tag: string) {
  return (ctx: GatewayContext): Response => {
    const response = ctx.response ?? new Response();
    const headers = new Headers(response.headers);
    headers.set('x-gateway-snapshot', tag);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

registerHook({ name: OLD_RESPONSE_HOOK, phase: 'onResponse', handler: tagResponse('old') });
registerHook({ name: NEW_RESPONSE_HOOK, phase: 'onResponse', handler: tagResponse('new') });

function writeConfig(dir: string, url: string, hooks: Record<string, string[]>) {
  fs.writeFileSync(path.join(dir, 'oracle-gateway.json'), JSON.stringify({
    services: { upstream: { url, timeout: 1000 } },
    routes: [{ match: '/api/snapshot', service: 'upstream', fallback: 'error' }],
    hooks,
  }));
}

async function waitUntil(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 1000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('timed out waiting for gateway reload');
    await Bun.sleep(10);
  }
}

function restoreHotReload(value: string | undefined) {
  if (value === undefined) delete process.env.ORACLE_GATEWAY_HOT_RELOAD;
  else process.env.ORACLE_GATEWAY_HOT_RELOAD = value;
}

describe('gateway runtime state snapshots', () => {
  test('keeps one request on its original hook pipeline during hot reload', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-gateway-snapshot-'));
    const savedHotReload = process.env.ORACLE_GATEWAY_HOT_RELOAD;
    const oldServer = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('old-upstream') });
    const newServer = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('new-upstream') });

    try {
      process.env.ORACLE_GATEWAY_HOT_RELOAD = '1';
      writeConfig(dir, `http://127.0.0.1:${oldServer.port}`, {
        onRequest: [PAUSE_HOOK],
        onResponse: [OLD_RESPONSE_HOOK],
      });
      const app = new Elysia().use(gatewayPlugin(dir));
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => { entered = resolve; });
      const wait = new Promise<void>((resolve) => { release = resolve; });
      pause = { entered, wait };

      const inFlight = app.handle(new Request('http://localhost/api/snapshot'));
      await started;
      const newUrl = `http://127.0.0.1:${newServer.port}`;
      writeConfig(dir, newUrl, { onResponse: [NEW_RESPONSE_HOOK] });
      await waitUntil(async () => {
        const res = await app.handle(new Request('http://localhost/api/gateway/status'));
        const body = await res.json() as { services?: { upstream?: { url: string } } };
        return body.services?.upstream?.url === newUrl;
      });

      release();
      const response = await inFlight;

      expect(await response.text()).toBe('old-upstream');
      expect(response.headers.get('x-gateway-snapshot')).toBe('old');
    } finally {
      pause = undefined;
      restoreHotReload(savedHotReload);
      await oldServer.stop(true);
      await newServer.stop(true);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
