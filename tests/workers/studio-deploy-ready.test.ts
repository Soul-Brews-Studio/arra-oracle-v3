import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function read(pathname: string): string {
  return readFileSync(pathname, 'utf8');
}

function parseJsonc<T>(source: string): T {
  return JSON.parse(stripTrailingCommas(stripComments(source))) as T;
}

function stripComments(source: string): string {
  return source.replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
}

function stripTrailingCommas(source: string): string {
  return source.replace(/,\s*([}\]])/g, '$1');
}

describe('workers/studio deploy readiness', () => {
  test('wrangler config uses Workers static assets with worker-first routing', () => {
    const cfg = parseJsonc<Record<string, any>>(read('workers/studio/wrangler.jsonc'));
    const entry = path.join('workers/studio', cfg.main);

    expect(cfg.name).toBe('arra-oracle-studio');
    expect(existsSync(entry)).toBe(true);
    expect(cfg.assets).toEqual({
      directory: '../../frontend/dist',
      binding: 'ASSETS',
      not_found_handling: 'single-page-application',
      run_worker_first: true,
    });
    expect(cfg.vars.ORACLE_URL).toContain('replace-with-your-oracle-backend');
    expect(cfg.vars.ORACLE_MCP_URL).toBe('https://arra-oracle-mcp.laris.workers.dev/mcp');
  });

  test('package scripts build the Vite frontend before wrangler deploy', () => {
    const pkg = JSON.parse(read('workers/studio/package.json')) as Record<string, any>;

    expect(pkg.scripts.build).toBe('cd ../../frontend && bun run build');
    expect(pkg.scripts.deploy).toBe('bun run build && wrangler deploy');
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(Object.keys(pkg.cloudflare.bindings)).toEqual(['ORACLE_URL', 'ORACLE_MCP_URL', 'ARRA_API_TOKEN']);
    expect(pkg.devDependencies).toMatchObject({
      typescript: expect.any(String),
      wrangler: expect.any(String),
    });
  });
});
