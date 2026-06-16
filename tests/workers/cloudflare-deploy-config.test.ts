import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const REPO_URL = 'https://github.com/Soul-Brews-Studio/arra-oracle-v3';
const BUTTON_IMAGE = 'https://deploy.workers.cloudflare.com/button';
const BUTTON_URL = `https://deploy.workers.cloudflare.com/?url=${REPO_URL}`;
const BUTTON_MARKDOWN = `[![Deploy to Cloudflare](${BUTTON_IMAGE})](${BUTTON_URL})`;

function read(path: string): string {
  return readFileSync(path, 'utf8');
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

  test('README deploy button uses the canonical Cloudflare Workers URL', () => {
    const readme = read('README.md');
    const matches = readme.match(/\[!\[Deploy to Cloudflare\]\(([^)]+)\)\]\(([^)]+)\)/g) ?? [];
    expect(matches).toEqual([BUTTON_MARKDOWN]);

    const target = new URL(BUTTON_URL);
    expect(target.origin).toBe('https://deploy.workers.cloudflare.com');
    expect(target.searchParams.get('url')).toBe(REPO_URL);
    expect(readme).toContain(`[![Deploy to Cloudflare](${BUTTON_IMAGE})]`);
  });
});
