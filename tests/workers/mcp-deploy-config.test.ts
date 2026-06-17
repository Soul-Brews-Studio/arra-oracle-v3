import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

type JsonRecord = Record<string, any>;

function readJson(path: string): JsonRecord {
  return JSON.parse(readFileSync(path, 'utf8')) as JsonRecord;
}

function readJsonc(path: string): JsonRecord {
  return JSON.parse(stripTrailingCommas(stripComments(readFileSync(path, 'utf8')))) as JsonRecord;
}

function stripComments(source: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (inString) {
      out += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      out += '\n';
    } else if (char === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i++;
    } else {
      out += char;
    }
  }
  return out;
}

function stripTrailingCommas(source: string): string {
  return source.replace(/,\s*([}\]])/g, '$1');
}

describe('workers/mcp deploy package', () => {
  test('declares the runtime dependencies needed by wrangler deploy', () => {
    const pkg = readJson('workers/mcp/package.json');

    expect(pkg.scripts).toMatchObject({
      build: 'tsc --noEmit',
      dev: 'wrangler dev --config wrangler.jsonc',
      deploy: 'tsc --noEmit && wrangler deploy --config wrangler.jsonc',
      typecheck: 'tsc --noEmit',
    });
    expect(pkg.dependencies).toMatchObject({
      '@modelcontextprotocol/sdk': expect.any(String),
      agents: expect.any(String),
      zod: expect.any(String),
    });
    expect(pkg.devDependencies).toMatchObject({
      '@cloudflare/workers-types': expect.any(String),
      wrangler: expect.any(String),
      typescript: expect.any(String),
    });
  });

  test('keeps the McpAgent worker deploy target wired to /mcp', () => {
    const cfg = readJsonc('workers/mcp/wrangler.jsonc');

    expect(cfg.name).toBe('arra-oracle-mcp');
    expect(cfg.main).toBe('src/index.ts');
    expect(cfg.compatibility_flags).toContain('nodejs_compat');
    expect(cfg.durable_objects.bindings).toContainEqual({ name: 'MCP_OBJECT', class_name: 'OracleMCP' });
    expect(cfg.migrations).toContainEqual({ tag: 'v1', new_sqlite_classes: ['OracleMCP'] });
    expect(cfg.vars.ORACLE_URL).toContain('replace-with-your-oracle-backend');
  });
});
