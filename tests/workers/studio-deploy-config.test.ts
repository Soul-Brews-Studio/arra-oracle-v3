import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function stripJsonc(input: string): string {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

function studioConfig() {
  return JSON.parse(stripJsonc(readFileSync('workers/studio/wrangler.jsonc', 'utf8')));
}

describe('Studio Worker deploy config', () => {
  test('serves the Vite frontend with Workers Static Assets before fallback', () => {
    const config = studioConfig();

    expect(config.name).toBe('arra-oracle-studio');
    expect(config.main).toBe('worker.ts');
    expect(config.assets).toEqual({
      directory: '../../frontend/dist',
      binding: 'ASSETS',
      not_found_handling: 'single-page-application',
      run_worker_first: true,
    });
  });

  test('keeps frontend API proxy URLs configurable', () => {
    const config = studioConfig();

    expect(config.vars.ORACLE_URL).toContain('replace-with-your-oracle-backend');
    expect(config.vars.ORACLE_ORIGIN_URL).toBeUndefined();
    expect(config.vars.ORACLE_MCP_URL).toBe('https://arra-oracle-mcp.laris.workers.dev/mcp');
  });
});
