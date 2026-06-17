import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

setDefaultTimeout(180_000);

type WorkerCase = {
  cwd: string;
  label: string;
  bindings: string[];
  prepare?: () => void;
};

function ensureStudioDist(): void {
  mkdirSync('frontend/dist/assets', { recursive: true });
  if (!existsSync('frontend/dist/index.html')) {
    writeFileSync('frontend/dist/index.html', '<!doctype html><div id="root"></div>');
  }
  if (!existsSync('frontend/dist/assets/studio-smoke-12345678.js')) {
    writeFileSync('frontend/dist/assets/studio-smoke-12345678.js', 'export {};');
  }
}

function dryRun(worker: WorkerCase) {
  worker.prepare?.();
  return spawnSync('bunx', ['wrangler', 'deploy', '--dry-run', '--config', 'wrangler.jsonc'], {
    cwd: worker.cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '1',
      NO_COLOR: '1',
      WRANGLER_SEND_METRICS: 'false',
    },
    timeout: 60_000,
  });
}

const workers: WorkerCase[] = [
  {
    cwd: 'workers/mcp',
    label: 'mcp',
    bindings: ['env.MCP_OBJECT', 'env.ORACLE_URL'],
  },
  {
    cwd: 'workers/studio',
    label: 'studio',
    bindings: ['env.ASSETS', 'env.ORACLE_URL', 'env.ORACLE_MCP_URL'],
    prepare: ensureStudioDist,
  },
  {
    cwd: 'workers/federation',
    label: 'federation',
    bindings: ['env.TUNNEL_URL'],
  },
];

describe('Cloudflare Worker deploy dry-runs', () => {
  for (const worker of workers) {
    test(`${worker.label} wrangler deploy --dry-run passes`, () => {
      const result = dryRun(worker);
      const output = `${result.stdout}\n${result.stderr}`;

      expect(result.status, output).toBe(0);
      expect(output).toContain('Total Upload');
      expect(output).toContain('--dry-run: exiting now');
      for (const binding of worker.bindings) expect(output).toContain(binding);
    });
  }
});
