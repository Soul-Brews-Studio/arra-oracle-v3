import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';

import { loadUnifiedPlugins } from '../../../src/plugins/unified-loader.ts';
import { writeUnifiedPlugin } from './unified-plugin-fixture.ts';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'unified-route-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('unified plugin api route surface', () => {
  test('registers one manifest apiRoute as an Elysia route', async () => {
    writeUnifiedPlugin(tmp, 'unified-route-demo', []);
    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });
    const app = new Elysia();
    for (const route of runtime.routes) app.use(route as any);

    const res = await app.handle(new Request('http://localhost/api/unified-route-demo/hello'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ source: 'handler' });
  });
});
