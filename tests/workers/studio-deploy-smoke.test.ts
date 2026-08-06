import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

function ensureFrontendDist(): void {
  mkdirSync('frontend/dist/assets', { recursive: true });
  writeFileSync('frontend/dist/index.html', '<!doctype html><div id="root"></div>');
  writeFileSync('frontend/dist/assets/studio-smoke-12345678.js', 'export {};');
}

function runWranglerDryRun() {
  ensureFrontendDist();
  return spawnSync('bunx', ['wrangler', 'deploy', '--dry-run'], {
    cwd: 'workers/studio',
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '1',
      NO_COLOR: '1',
      WRANGLER_SEND_METRICS: 'false',
    },
  });
}

describe('Studio Worker deploy smoke', () => {
  test('wrangler deploy --dry-run succeeds for workers/studio', () => {
    const result = runWranglerDryRun();
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status, output).toBe(0);
    expect(output).toContain('Total Upload');
    expect(output).toContain('env.ASSETS');
    expect(output).toContain('env.ORACLE_MCP_URL');
    expect(output).toContain('--dry-run: exiting now');
  });
});
