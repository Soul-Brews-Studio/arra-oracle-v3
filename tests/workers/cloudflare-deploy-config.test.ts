import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const REPO_URL = 'https://github.com/Soul-Brews-Studio/arra-oracle-v3';
const BUTTON_IMAGE = 'https://deploy.workers.cloudflare.com/button';
const BUTTON_URL = `https://deploy.workers.cloudflare.com/?url=${REPO_URL}`;
const BUTTON_MARKDOWN = `[![Deploy to Cloudflare](${BUTTON_IMAGE})](${BUTTON_URL})`;

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function readJson<T>(path: string): T {
  return JSON.parse(read(path)) as T;
}

function parseJsonc<T>(source: string): T {
  return JSON.parse(stripTrailingCommas(stripComments(source))) as T;
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
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += char;
  }
  return out;
}

function stripTrailingCommas(source: string): string {
  return source.replace(/,\s*([}\]])/g, '$1');
}

describe('Cloudflare deploy metadata', () => {
  test('deploy docs list dry-run commands and required Worker environment', () => {
    const docs = read('docs/workers-deploy-configs.md');

    for (const command of [
      'bun run cloudflare:mcp:dry-run',
      'bun run cloudflare:studio:dry-run',
      'bun run cloudflare:federation:dry-run',
    ]) {
      expect(docs).toContain(command);
    }

    for (const envName of [
      'MCP_OBJECT',
      'ORACLE_ORIGIN_URL',
      'ORACLE_URL',
      'ORACLE_HTTP_URL',
      'ORACLE_API',
      'ORACLE_MCP_URL',
      'ARRA_API_TOKEN',
      'ARRA_API_KEY',
      'ORACLE_TENANT_ID',
      'ORACLE_DB',
      'ORACLE_TENANTS_TABLE',
      'ASSETS',
      'TUNNEL_URL',
      'FEDERATION_TOKEN',
      'federationToken',
    ]) {
      expect(docs).toContain(`\`${envName}\``);
    }
  });

  test('root package scripts point at the active Worker configs', () => {
    const pkg = readJson<Record<string, any>>('package.json');

    expect(pkg.scripts).toMatchObject({
      'cloudflare:mcp:dev': 'wrangler dev --config workers/mcp/wrangler.jsonc',
      'cloudflare:mcp:deploy': 'wrangler deploy --config workers/mcp/wrangler.jsonc',
      'cloudflare:mcp:dry-run': 'wrangler deploy --dry-run --config workers/mcp/wrangler.jsonc',
      'cloudflare:studio:dev': 'cd frontend && bun run build && cd .. && wrangler dev --config workers/studio/wrangler.jsonc',
      'cloudflare:studio:deploy': 'cd frontend && bun run build && cd .. && wrangler deploy --config workers/studio/wrangler.jsonc',
      'cloudflare:studio:dry-run':
        'cd frontend && bun run build && cd .. && wrangler deploy --dry-run --config workers/studio/wrangler.jsonc',
      'cloudflare:federation:dev': 'wrangler dev --config workers/federation/wrangler.jsonc',
      'cloudflare:federation:deploy': 'wrangler deploy --config workers/federation/wrangler.jsonc',
      'cloudflare:federation:dry-run': 'wrangler deploy --dry-run --config workers/federation/wrangler.jsonc',
    });
  });

  test('root Wrangler config points at the active MCP Worker', () => {
    const cfg = parseJsonc<Record<string, any>>(read('wrangler.jsonc'));

    expect(cfg.name).toBe('arra-oracle-mcp');
    expect(cfg.main).toBe('workers/mcp/src/index.ts');
    expect(cfg.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cfg.compatibility_flags).toContain('nodejs_compat');
    expect(cfg.durable_objects.bindings).toContainEqual({
      name: 'MCP_OBJECT',
      class_name: 'OracleMCP',
    });
    expect(cfg.migrations).toContainEqual({ tag: 'v1', new_sqlite_classes: ['OracleMCP'] });
    expect(cfg.vars.ORACLE_URL).toContain('replace-with-your-oracle-backend');
  });

  test('workers/mcp package has explicit build and deploy scripts', () => {
    const pkg = readJson<Record<string, any>>('workers/mcp/package.json');

    expect(pkg.scripts).toMatchObject({
      build: 'tsc --noEmit',
      dev: 'wrangler dev --config wrangler.jsonc',
      deploy: 'tsc --noEmit && wrangler deploy --config wrangler.jsonc',
      'dry-run': 'tsc --noEmit && wrangler deploy --dry-run --config wrangler.jsonc',
      typecheck: 'tsc --noEmit',
    });
  });

  test('workers/mcp Wrangler config keeps the backend proxy var', () => {
    const cfg = parseJsonc<Record<string, any>>(read('workers/mcp/wrangler.jsonc'));

    expect(cfg.main).toBe('src/index.ts');
    expect(cfg.compatibility_flags).toContain('nodejs_compat');
    expect(cfg.durable_objects.bindings).toContainEqual({
      name: 'MCP_OBJECT',
      class_name: 'OracleMCP',
    });
    expect(cfg.vars).toEqual({
      ORACLE_URL: 'https://replace-with-your-oracle-backend.example.com',
    });
  });

  test('README deploy button uses the canonical Cloudflare Workers URL', () => {
    const readme = read('README.md');
    const matches = readme.match(/\[!\[Deploy to Cloudflare\]\(([^)]+)\)\]\(([^)]+)\)/g) ?? [];
    expect(matches).toEqual([BUTTON_MARKDOWN]);

    const target = new URL(BUTTON_URL);
    expect(target.origin).toBe('https://deploy.workers.cloudflare.com');
    expect(target.searchParams.get('url')).toBe(REPO_URL);
    expect(readme).toContain(`[![Deploy to Cloudflare](${BUTTON_IMAGE})]`);
  });

  test('workers/mcp package stays deploy-ready for Wrangler', () => {
    const cfg = parseJsonc<Record<string, any>>(read('workers/mcp/wrangler.jsonc'));
    const pkg = JSON.parse(read('workers/mcp/package.json')) as Record<string, any>;

    expect(pkg.scripts.deploy).toBe('tsc --noEmit && wrangler deploy --config wrangler.jsonc');
    expect(pkg.scripts['dry-run']).toBe('tsc --noEmit && wrangler deploy --dry-run --config wrangler.jsonc');
    expect(pkg.dependencies).toMatchObject({
      '@modelcontextprotocol/sdk': expect.any(String),
      agents: expect.any(String),
      zod: expect.any(String),
    });
    expect(pkg.devDependencies).toMatchObject({
      '@cloudflare/workers-types': expect.any(String),
      wrangler: expect.any(String),
    });

    expect(cfg.name).toBe('arra-oracle-mcp');
    expect(cfg.main).toBe('src/index.ts');
    expect(cfg.durable_objects.bindings).toContainEqual({ name: 'MCP_OBJECT', class_name: 'OracleMCP' });
    expect(cfg.migrations).toContainEqual({ tag: 'v1', new_sqlite_classes: ['OracleMCP'] });
    expect(cfg.vars.ORACLE_URL).toContain('replace-with-your-oracle-backend');
  });
});
