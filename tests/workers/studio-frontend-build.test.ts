import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

setDefaultTimeout(120_000);

const FRONTEND_DIR = 'frontend';
const DIST_DIR = join(FRONTEND_DIR, 'dist');
const ASSETS_DIR = join(DIST_DIR, 'assets');

async function streamText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return '';
  return new Response(stream).text();
}

async function runFrontendBuild(): Promise<string> {
  const proc = Bun.spawn(['bun', 'run', 'build'], {
    cwd: FRONTEND_DIR,
    env: { ...process.env, CI: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    streamText(proc.stdout),
    streamText(proc.stderr),
    proc.exited,
  ]);
  const output = `${stdout}\n${stderr}`.trim();
  if (code !== 0) throw new Error(`frontend build failed (${code})\n${output}`);
  return output;
}

function file(path: string): string {
  return readFileSync(path, 'utf8');
}

function stripAnsi(input: string): string {
  return input.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

describe('Oracle Studio frontend Workers Static Assets build', () => {
  let buildOutput = '';

  beforeAll(async () => {
    buildOutput = await runFrontendBuild();
  });

  test('package build script produces a Vite dist directory', () => {
    const pkg = JSON.parse(file(join(FRONTEND_DIR, 'package.json'))) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.build).toBe('tsc --noEmit && vite build');

    expect(buildOutput).toContain('vite v');
    expect(stripAnsi(buildOutput)).toContain('dist/index.html');
    expect(existsSync(DIST_DIR)).toBe(true);
  });

  test('Studio Worker assets binding points at the built dist directory', () => {
    const config = JSON.parse(file('workers/studio/wrangler.jsonc')) as {
      assets?: Record<string, unknown>;
    };

    expect(config.assets).toMatchObject({
      directory: '../../frontend/dist',
      binding: 'ASSETS',
      not_found_handling: 'single-page-application',
      run_worker_first: true,
    });
    expect(existsSync(join('workers/studio', '../../frontend/dist', 'index.html'))).toBe(true);
  });

  test('dist output is rooted for ui-oracle-style Workers assets', () => {
    const index = file(join(DIST_DIR, 'index.html'));
    const assets = readdirSync(ASSETS_DIR).sort();
    const jsAssets = assets.filter((name) => name.endsWith('.js'));
    const cssAssets = assets.filter((name) => name.endsWith('.css'));

    expect(jsAssets.length).toBeGreaterThan(0);
    expect(cssAssets.length).toBeGreaterThan(0);
    expect(index).toContain('<div id="root"></div>');
    expect(index).toContain('href="/manifest.json"');
    expect(index).toContain('href="/icons/arra-oracle.svg"');
    expect(index).not.toContain('/src/main.tsx');
    expect(index).not.toContain('http://127.0.0.1');

    for (const asset of [...jsAssets, ...cssAssets]) {
      expect(asset).toMatch(/^[\w.-]+-[A-Za-z0-9_-]{8,}\.(js|css)$/);
      expect(index).toContain(`/assets/${asset}`);
      expect(statSync(join(ASSETS_DIR, asset)).size).toBeGreaterThan(0);
    }
  });

  test('public app shell files are copied beside index.html', () => {
    const manifest = file(join(DIST_DIR, 'manifest.json'));
    const serviceWorker = file(join(DIST_DIR, 'sw.js'));

    expect(JSON.parse(manifest)).toMatchObject({
      name: 'Arra Oracle Control Surface',
      start_url: '/menu',
      scope: '/',
    });
    expect(existsSync(join(DIST_DIR, 'icons', 'arra-oracle.svg'))).toBe(true);
    expect(serviceWorker).toContain("caches.match('/index.html')");
    expect(serviceWorker).toContain("url.pathname.startsWith('/api/')");
  });
});
