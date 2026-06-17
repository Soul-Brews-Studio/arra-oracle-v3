import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const REPO_URL = 'https://github.com/Soul-Brews-Studio/arra-oracle-v3';
const STUDIO_URL = `${REPO_URL}/tree/alpha/workers/studio`;
const BUTTON_IMAGE = 'https://deploy.workers.cloudflare.com/button';
const MCP_BUTTON_URL = `https://deploy.workers.cloudflare.com/?url=${REPO_URL}`;
const STUDIO_BUTTON_URL = `https://deploy.workers.cloudflare.com/?url=${STUDIO_URL}`;
const MCP_BUTTON_MARKDOWN = `[![Deploy MCP Worker](${BUTTON_IMAGE})](${MCP_BUTTON_URL})`;
const STUDIO_BUTTON_MARKDOWN = `[![Deploy Studio Worker](${BUTTON_IMAGE})](${STUDIO_BUTTON_URL})`;

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
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
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

describe('Cloudflare deploy metadata', () => {
  test('root wrangler.jsonc stays parseable and points at the remote MCP worker', () => {
    const cfg = parseJsonc<Record<string, any>>(read('wrangler.jsonc'));

    expect(cfg.name).toBe('arra-oracle-remote-mcp');
    expect(cfg.main).toBe('./src/workers/oracle-mcp.ts');
    expect(cfg.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cfg.compatibility_flags).toContain('nodejs_compat');
    expect(cfg.workers_dev).toBe(true);
    expect(cfg.observability).toMatchObject({ enabled: true });
    expect(cfg.vars).toMatchObject({
      ORACLE_MCP_PATH: '/mcp',
      ORACLE_STORAGE_BACKEND: 'd1',
      ORACLE_VECTOR_BACKEND: 'cloudflare-vectorize',
    });
  });

  test('package metadata describes each root Wrangler deploy var', () => {
    const cfg = parseJsonc<Record<string, any>>(read('wrangler.jsonc'));
    const pkg = readJson<Record<string, any>>('package.json');
    const bindings = pkg.cloudflare?.bindings ?? {};

    for (const key of Object.keys(cfg.vars ?? {})) {
      expect(typeof bindings[key]?.description).toBe('string');
      expect(bindings[key].description.trim().length).toBeGreaterThan(20);
    }
  });

  test('README deploy buttons use canonical Cloudflare Workers URLs', () => {
    const readme = read('README.md');
    const matches = readme.match(/\[!\[Deploy (?:MCP|Studio) Worker\]\(([^)]+)\)\]\(([^)]+)\)/g) ?? [];
    expect(matches).toEqual([MCP_BUTTON_MARKDOWN, STUDIO_BUTTON_MARKDOWN]);

    const mcpTarget = new URL(MCP_BUTTON_URL);
    const studioTarget = new URL(STUDIO_BUTTON_URL);
    expect(mcpTarget.origin).toBe('https://deploy.workers.cloudflare.com');
    expect(studioTarget.origin).toBe('https://deploy.workers.cloudflare.com');
    expect(mcpTarget.searchParams.get('url')).toBe(REPO_URL);
    expect(studioTarget.searchParams.get('url')).toBe(STUDIO_URL);
    expect(readme).toContain(`[![Deploy Studio Worker](${BUTTON_IMAGE})]`);
  });
});
