import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const workflow = () => readFileSync('.github/workflows/deploy-studio-worker.yml', 'utf8');

describe('Studio Worker deployment workflow', () => {
  test('deploys Oracle Studio from alpha with Wrangler', () => {
    const yml = workflow();

    expect(yml).toContain('branches: [alpha]');
    expect(yml).toContain('cloudflare/wrangler-action@v3');
    expect(yml).toContain('deploy --config workers/studio/wrangler.jsonc');
    expect(yml).toContain('CLOUDFLARE_API_TOKEN');
    expect(yml).toContain('CLOUDFLARE_ACCOUNT_ID');
    expect(yml).toContain('https://arra-oracle-studio.workers.dev');
  });

  test('builds the Vite frontend before deploy', () => {
    const yml = workflow();

    expect(yml).toContain('frontend/**');
    expect(yml).toContain('workers/studio/**');
    expect(yml).toContain('cd frontend && bun run build');
    expect(yml).toContain('tests/workers/studio-*.test.ts');
  });

  test('waits for the Studio worker implementation without failing alpha', () => {
    const yml = workflow();

    expect(yml).toContain('id: studio');
    expect(yml).toContain('ready=true');
    expect(yml).toContain("if: steps.studio.outputs.ready == 'true'");
    expect(yml).toContain('workers/studio is not complete on this ref; skipping deploy.');
  });

  test('keeps Studio on Workers Static Assets, not Cloudflare Pages', () => {
    const yml = workflow();

    expect(yml).not.toContain('wrangler pages');
    expect(yml).not.toContain('pages deploy');
  });
});
