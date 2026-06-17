import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { handleStudioRequest } from '../../workers/studio/worker.ts';

type Json = Record<string, any>;

function readJson(path: string): Json {
  return JSON.parse(readFileSync(path, 'utf8')) as Json;
}

function env(assetText = 'asset') {
  return {
    ORACLE_URL: 'https://oracle.example.test/root/',
    ORACLE_MCP_URL: 'https://mcp.example.test/mcp',
    ARRA_API_TOKEN: 'secret',
    ASSETS: {
      fetch: async (request: Request) => new Response(assetText, {
        headers: { 'x-asset-path': new URL(request.url).pathname },
      }),
    },
  };
}

describe('Oracle Studio Worker deploy surface', () => {
  test('package scripts build frontend and deploy with wrangler', () => {
    const pkg = readJson('workers/studio/package.json');

    expect(pkg.scripts.build).toBe('cd ../../frontend && bun run build');
    expect(pkg.scripts.deploy).toBe('bun run build && wrangler deploy --config wrangler.jsonc');
    expect(pkg.scripts['dry-run']).toBe('bun run build && wrangler deploy --dry-run --config wrangler.jsonc');
    expect(pkg.type).toBe('module');
    expect(pkg.private).toBe(true);
  });

  test('wrangler config uses Workers Static Assets', () => {
    const cfg = readJson('workers/studio/wrangler.jsonc');

    expect(cfg.main).toBe('worker.ts');
    expect(cfg.assets).toMatchObject({
      directory: '../../frontend/dist',
      binding: 'ASSETS',
      not_found_handling: 'single-page-application',
      run_worker_first: true,
    });
    expect(cfg.vars.ORACLE_URL).toContain('replace-with-your-oracle-backend');
  });

  test('proxies /api requests to ORACLE_URL with auth', async () => {
    const originalFetch = globalThis.fetch;
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), init });
      return Response.json({ ok: true });
    }) as typeof fetch;

    try {
      const response = await handleStudioRequest(
        new Request('https://studio.test/api/search?q=oracle', { headers: { host: 'studio.test' } }),
        env(),
      );

      expect(response.status).toBe(200);
      expect(seen[0].url).toBe('https://oracle.example.test/root/api/search?q=oracle');
      const headers = new Headers(seen[0].init?.headers);
      expect(headers.get('authorization')).toBe('Bearer secret');
      expect(headers.has('host')).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });


  test('proxies /mcp requests to the configured MCP worker', async () => {
    const originalFetch = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return Response.json({ ok: true, mcp: true });
    }) as typeof fetch;

    try {
      const response = await handleStudioRequest(new Request('https://studio.test/mcp?session=1'), env());

      expect(response.status).toBe(200);
      expect(seen).toEqual(['https://mcp.example.test/mcp?session=1']);
      expect(await response.json()).toEqual({ ok: true, mcp: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('serves static assets with ui-oracle cache policy', async () => {
    const hashed = await handleStudioRequest(new Request('https://studio.test/assets/app-a1b2c3d4.js'), env());
    const html = await handleStudioRequest(new Request('https://studio.test/dashboard'), env('<html></html>'));

    expect(await hashed.text()).toBe('asset');
    expect(hashed.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await html.text()).toBe('<html></html>');
    expect(html.headers.get('cache-control')).toBe('public, max-age=3600, stale-while-revalidate=86400');
  });
});
