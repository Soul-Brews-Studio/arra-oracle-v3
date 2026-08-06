import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const workflow = () => readFileSync('.github/workflows/deploy-canvas-worker.yml', 'utf8');

describe('canvas worker deployment workflow', () => {
  test('deploys the canvas Cloudflare Worker from alpha with Wrangler', () => {
    const yml = workflow();

    expect(yml).toContain('branches: [alpha]');
    expect(yml).toContain('cloudflare/wrangler-action@v3');
    expect(yml).toContain('deploy --config workers/canvas/wrangler.toml');
    expect(yml).toContain('CLOUDFLARE_API_TOKEN');
    expect(yml).toContain('CLOUDFLARE_ACCOUNT_ID');
  });

  test('keeps canvas on Workers, not Cloudflare Pages', () => {
    const yml = workflow();

    expect(yml).not.toContain('wrangler pages');
    expect(yml).not.toContain('pages deploy');
    expect(yml).toContain('canvas.buildwithoracle.com');
  });
});
