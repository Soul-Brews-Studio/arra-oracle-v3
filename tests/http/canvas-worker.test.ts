import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { handleCanvasRequest } from '../../src/workers/canvas/index.ts';

describe('canvas subdomain worker app', () => {
  test('renders wave, map, planets, and legacy three plugins over HTTPS', async () => {
    for (const plugin of ['wave', 'map', 'planets', 'cube', 'galaxy', 'torus', 'graph3d', 'solar', 'map3d']) {
      const response = await handleCanvasRequest(new Request(`https://canvas.buildwithoracle.com/?plugin=${plugin}`));
      const html = await response.text();

      expect(response.status, plugin).toBe(200);
      expect(response.headers.get('content-type'), plugin).toContain('text/html');
      expect(html, plugin).toContain(`plugin=${plugin}`);
      expect(html, plugin).toContain('canvas.buildwithoracle.com');
    }
  });

  test('supports clean path plugin URLs and preserves API proxy cache headers', async () => {
    const page = await handleCanvasRequest(new Request('https://canvas.buildwithoracle.com/planets'));
    expect(await page.text()).toContain('plugin=planets');

    const preflight = await handleCanvasRequest(new Request('https://canvas.buildwithoracle.com/api/health', { method: 'OPTIONS' }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('cache-control')).toBe('no-store');
  });

  test('wrangler custom domain runs worker first', () => {
    const config = readFileSync('workers/canvas/wrangler.toml', 'utf8');
    expect(config).toContain('canvas.buildwithoracle.com');
    expect(config).toContain('custom_domain = true');
    expect(config).toContain('run_worker_first = true');
  });
});
