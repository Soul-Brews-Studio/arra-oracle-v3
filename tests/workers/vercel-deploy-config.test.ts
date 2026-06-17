import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import handler, { buildProxyTarget, proxyRequestHeaders, resolveOracleUrl } from '../../api/proxy.ts';

const REPO_URL = 'https://github.com/Soul-Brews-Studio/arra-oracle-v3';
const BUTTON = '[![Deploy with Vercel](https://vercel.com/button)]';
const originalFetch = globalThis.fetch;
const originalOracleUrl = process.env.ORACLE_URL;

type VercelConfig = {
  buildCommand: string;
  outputDirectory: string;
  rewrites: Array<{ source: string; destination: string }>;
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalOracleUrl === undefined) delete process.env.ORACLE_URL;
  else process.env.ORACLE_URL = originalOracleUrl;
});

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function readJson<T>(path: string): T {
  return JSON.parse(read(path)) as T;
}

async function withProxyServer<T>(run: (base: string) => Promise<T>): Promise<T> {
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

describe('Vercel Studio deploy config', () => {
  test('builds the frontend and rewrites API traffic through api/proxy.ts', () => {
    const cfg = readJson<VercelConfig>('vercel.json');

    expect(cfg.buildCommand).toBe('cd frontend && bun run build');
    expect(cfg.outputDirectory).toBe('frontend/dist');
    expect(cfg.rewrites).toContainEqual({ source: '/api/:path*', destination: '/api/proxy?path=:path*' });
    expect(cfg.rewrites.at(-1)).toEqual({ source: '/(.*)', destination: '/index.html' });
    expect(cfg.headers).toContainEqual({
      source: '/api/(.*)',
      headers: [{ key: 'Cache-Control', value: 'no-store' }],
    });
  });

  test('README exposes a Vercel deploy button wired to ORACLE_URL', () => {
    const readme = read('README.md');
    const match = readme.match(/\[!\[Deploy with Vercel\]\(https:\/\/vercel\.com\/button\)\]\(([^)]+)\)/);

    expect(match?.[0]).toStartWith(BUTTON);
    const target = new URL(match?.[1] ?? '');
    expect(target.origin).toBe('https://vercel.com');
    expect(target.pathname).toBe('/new/clone');
    expect(target.searchParams.get('repository-url')).toBe(REPO_URL);
    expect(target.searchParams.get('env')).toBe('ORACLE_URL');
    expect(readme).toContain('docs/deploy-vercel.md');
  });

  test('proxy helpers normalize backend URLs, paths, queries, and headers', () => {
    const base = resolveOracleUrl({ ORACLE_URL: 'https://user:pass@oracle.example/root/?debug=1#x' });
    const target = buildProxyTarget(base, '/api/proxy?path=vector/config&limit=3');
    const headers = proxyRequestHeaders({ host: 'spoofed.example', authorization: 'Bearer token', connection: 'keep-alive' });

    expect(base).toBe('https://oracle.example/root');
    expect(target).toBe('https://oracle.example/root/api/vector/config?limit=3');
    expect(headers.get('authorization')).toBe('Bearer token');
    expect(headers.get('host')).toBeNull();
    expect(headers.get('connection')).toBeNull();
    expect(headers.get('x-oracle-studio-vercel')).toBe('oracle-studio-vercel');
  });

  test('serverless handler proxies method, query, headers, and body', async () => {
    process.env.ORACLE_URL = 'https://oracle.example/root';
    const seen: Array<{ url: string; method: string; marker: string | null; body: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      seen.push({
        url: String(input),
        method: request.method,
        marker: request.headers.get('x-oracle-studio-vercel'),
        body: await request.text(),
      });
      return new Response('proxied', { status: 202, headers: { 'content-type': 'text/plain' } });
    }) as typeof fetch;

    await withProxyServer(async (base) => {
      const response = await originalFetch(`${base}/api/proxy?path=search&q=vector`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"limit":1}',
      });

      expect(response.status).toBe(202);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-oracle-studio-vercel')).toBe('oracle-studio-vercel');
      expect(await response.text()).toBe('proxied');
    });

    expect(seen).toEqual([{ url: 'https://oracle.example/root/api/search?q=vector', method: 'POST', marker: 'oracle-studio-vercel', body: '{"limit":1}' }]);
  });
});
