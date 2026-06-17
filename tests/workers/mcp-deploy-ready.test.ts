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

describe('workers/mcp deploy readiness', () => {
  test('wrangler deploy config points at the existing McpAgent entrypoint', () => {
    const cfg = parseJsonc<Record<string, any>>(read('workers/mcp/wrangler.jsonc'));
    const entry = path.join('workers/mcp', cfg.main);

    expect(cfg.name).toBe('arra-oracle-mcp');
    expect(cfg.main).toBe('src/index.ts');
    expect(existsSync(entry)).toBe(true);
    expect(cfg.compatibility_flags).toContain('nodejs_compat');
    expect(cfg.durable_objects.bindings).toContainEqual({
      name: 'MCP_OBJECT',
      class_name: 'OracleMCP',
    });
    expect(cfg.migrations).toContainEqual({
      tag: 'v1',
      new_sqlite_classes: ['OracleMCP'],
    });
  });

  test('worker package keeps the dependencies needed by wrangler deploy', () => {
    const pkg = JSON.parse(read('workers/mcp/package.json')) as Record<string, any>;

    expect(pkg.scripts.deploy).toBe('wrangler deploy');
    expect(pkg.dependencies).toMatchObject({
      '@modelcontextprotocol/sdk': expect.any(String),
      agents: expect.any(String),
      zod: expect.any(String),
    });
    expect(pkg.devDependencies).toMatchObject({
      '@cloudflare/workers-types': expect.any(String),
      typescript: expect.any(String),
      wrangler: expect.any(String),
    });
  });
});
