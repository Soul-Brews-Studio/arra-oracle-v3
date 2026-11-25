/** GET /instructions (#3110): a plain-text agent guide whose addresses match the URL the caller used. */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { createInstructionsRoutes } from '../../../src/routes/instructions/index.ts';
import { createSpaMiddleware } from '../../../src/middleware/spa.ts';

const dataDir = (config?: object) => {
  const dir = mkdtempSync(join(tmpdir(), 'arra-instr-'));
  if (config) writeFileSync(join(dir, 'arra.json'), JSON.stringify(config));
  return dir;
};
const get = (app: Elysia, url: string, accept = '*/*') => app.handle(new Request(url, { headers: { accept } }));

describe('GET /instructions', () => {
  test('plain text, addresses built from the caller URL', async () => {
    const app = new Elysia().use(createInstructionsRoutes('1.2.3', dataDir({ name: 'm5' })));
    const res = await get(app, 'http://m5.example.ts.net:47944/instructions');
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('MCP endpoint: http://m5.example.ts.net:47944/mcp');
    expect(body).toContain('v1.2.3');
    expect(body).not.toContain('## Hub');
  });
  test('a hub adds how to join, and never prints a code or token', async () => {
    const app = new Elysia().use(createInstructionsRoutes('1', dataDir({ name: 'm5', hub: { name: 'soul-brews' } })));
    const body = await (await get(app, 'http://127.0.0.1:47944/instructions')).text();
    expect(body).toContain('## Hub: soul-brews');
    expect(body).toContain('arra join http://127.0.0.1:47944 --code <code>');
    expect(body).not.toMatch(/[a-f0-9]{32,}/);
  });
  test('a browser also gets the text, not the Studio shell', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'arra-dist-'));
    writeFileSync(join(dist, 'index.html'), '<title>Studio</title>');
    const app = new Elysia().use(createSpaMiddleware({ distDir: dist })).use(createInstructionsRoutes('1', dataDir({ name: 'm5' })));
    const body = await (await get(app, 'http://127.0.0.1/instructions', 'text/html')).text();
    expect(body).toStartWith('# arra (m5)');
  });
});
