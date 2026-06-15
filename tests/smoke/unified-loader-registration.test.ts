import { expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { createSmokeEnv, logSmoke } from './_helpers.ts';
import { loadUnifiedPlugins } from '../../src/plugins/unified-loader.ts';

test('unified loader registers smoke plugin API, MCP, menu, and CLI surfaces', async () => {
  const smoke = createSmokeEnv('unified-loader');
  const base = join(smoke.home, '.oracle', 'plugins');
  const dir = join(base, 'smoke-loader');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
    name: 'smoke-loader',
    version: '1.0.0',
    entry: './index.ts',
    apiRoutes: [{ path: '/api/smoke-loader', methods: ['GET'], handler: 'api' }],
    mcpTools: [{ name: 'smoke_loader_tool', description: 'smoke tool', inputSchema: {}, handler: 'tool' }],
    menu: [{ label: 'Smoke Loader', path: '/smoke-loader', group: 'tools' }],
    cliSubcommands: [{ command: 'smoke-loader', help: 'smoke loader' }],
  }, null, 2));
  writeFileSync(join(dir, 'index.ts'), `
    export function api() { return { body: { ok: true, surface: 'api' } }; }
    export function tool(ctx) { return { ok: true, surface: 'mcp', args: ctx.body }; }
  `);

  try {
    const runtime = await loadUnifiedPlugins({ dirs: [base] });
    const app = new Elysia();
    for (const route of runtime.routes) app.use(route as never);
    const res = await app.handle(new Request('http://local/api/smoke-loader'));
    const mcpResult = await runtime.callMcpTool('smoke_loader_tool', { value: 7 });

    expect(runtime.routes).toHaveLength(1);
    expect(runtime.mcpTools).toHaveLength(1);
    expect(runtime.menu).toHaveLength(1);
    expect(runtime.cliSubcommands).toHaveLength(1);
    expect(await res.json()).toEqual({ ok: true, surface: 'api' });
    expect(mcpResult).toMatchObject({ ok: true, surface: 'mcp', args: { value: 7 } });
    logSmoke('unified-loader-registration', { routes: runtime.routes.length, tools: runtime.mcpTools.length });
    await runtime.stop();
  } finally {
    rmSync(smoke.root, { recursive: true, force: true });
  }
});
