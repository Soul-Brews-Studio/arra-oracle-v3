// HTTP contract tests — files + plugins routes. Uses Elysia's app.handle()
// for in-process testing with isolated ORACLE_DATA_DIR and a mocked os
// module so the real user plugin dir is never touched.
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import * as realOs from 'os';
import { join } from 'path';

const WASM_HEADER = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

let tmp: string;
// combined: mirrors production — files.ts registers /api/plugins first and
// shadows plugins.ts. pluginsOnly: canonical dual-layout scanner in isolation.
let combined: any;
let pluginsOnly: any;

beforeAll(async () => {
  tmp = mkdtempSync(join(realOs.tmpdir(), 'blue-http-'));
  writeFileSync(join(tmp, 'hello.txt'), 'hello from repo root');

  // files.ts PLUGINS_DIR = ORACLE_DATA_DIR/plugins (flat .wasm only).
  mkdirSync(join(tmp, 'plugins'), { recursive: true });
  writeFileSync(join(tmp, 'plugins', 'alpha.wasm'), WASM_HEADER);

  // plugins.ts captures PLUGIN_DIR at module load via os.homedir(), which
  // bypasses the HOME env var — mock os before dynamic import.
  const fakeHome = join(tmp, 'fake-home');
  mkdirSync(fakeHome, { recursive: true });
  mock.module('os', () => ({ ...realOs, default: realOs, homedir: () => fakeHome }));

  const canonical = join(fakeHome, '.oracle', 'plugins');
  mkdirSync(canonical, { recursive: true });
  // Flat entry.
  writeFileSync(join(canonical, 'flat.wasm'), WASM_HEADER);
  // Nested entry whose manifest.wasm points at a full source path that
  // doesn't exist at that literal path — scanner must fall back to
  // basename resolution in the install dir. The directory name matches
  // the manifest `name` so /api/plugins/:name resolution also hits it.
  const nested = join(canonical, 'nested-plugin');
  mkdirSync(nested, { recursive: true });
  writeFileSync(
    join(nested, 'plugin.json'),
    JSON.stringify({
      name: 'nested-plugin',
      version: '2.0.0',
      description: 'dual-layout fixture',
      wasm: '/tmp/never-exists/nested-plugin.wasm',
    }),
  );
  writeFileSync(join(nested, 'nested-plugin.wasm'), WASM_HEADER);

  // Isolate the server from user state BEFORE dynamic imports run config.ts.
  process.env.ORACLE_DATA_DIR = tmp;
  process.env.HOME = tmp;
  process.env.ORACLE_REPO_ROOT = tmp;
  process.env.GHQ_ROOT = join(tmp, 'ghq-fake');
  mkdirSync(process.env.GHQ_ROOT, { recursive: true });

  const { Elysia } = await import('elysia');
  const { filesRouter } = await import('../../src/routes/files/index.ts');
  const { pluginsRouter } = await import('../../src/routes/plugins/index.ts');

  // combined: filesRouter only — it already bundles the legacy flat
  // /api/plugins + /api/plugins/:name (files/plugins.ts + files/plugin-by-name.ts),
  // shadowing the canonical dual-layout scanner. Mixing in pluginsRouter
  // here would not change observable behavior because Elysia's parametric
  // route resolution is first-match on the internal tree — filesRouter
  // alone is the source of truth for the "combined" contract.
  combined = new Elysia().use(filesRouter);
  pluginsOnly = new Elysia().use(pluginsRouter);
});

const req = (path: string) => new Request(`http://localhost${path}`);

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('GET /api/file — security', () => {
  test('rejects path traversal with ".."', async () => {
    const res = await combined.handle(req('/api/file?path=../etc/passwd'));
    expect([400, 403, 404, 422]).toContain(res.status);
    // Must not leak /etc/passwd content.
    const body = await res.text();
    expect(body).not.toMatch(/root:x:/);
  });

  test('rejects nested ".." segments', async () => {
    const res = await combined.handle(req('/api/file?path=sub/../../etc/passwd'));
    expect([400, 403, 404, 422]).toContain(res.status);
  });

  test('rejects null-byte injection', async () => {
    const res = await combined.handle(req('/api/file?path=hello.txt%00.png'));
    expect([400, 403, 404, 422]).toContain(res.status);
  });

  test('rejects missing path parameter', async () => {
    const res = await combined.handle(req('/api/file'));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/file — happy path', () => {
  test('reads file inside REPO_ROOT', async () => {
    const res = await combined.handle(req('/api/file?path=hello.txt'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello from repo root');
  });

  test('returns 4xx for missing file inside REPO_ROOT', async () => {
    const res = await combined.handle(req('/api/file?path=does-not-exist.txt'));
    expect([400, 404]).toContain(res.status);
  });

  test('accepts project param without throwing (falls through to 4xx)', async () => {
    const res = await combined.handle(
      req('/api/file?project=github.com/fake/repo&path=README.md'),
    );
    expect([200, 400, 404]).toContain(res.status);
  });
});

describe('GET /api/read', () => {
  test('rejects missing file+id params', async () => {
    const res = await combined.handle(req('/api/read'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeDefined();
  });
});

describe('GET /api/doc/:id', () => {
  test('returns 404 for nonexistent document', async () => {
    const res = await combined.handle(req('/api/doc/does-not-exist'));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeDefined();
  });
});

describe('GET /api/logs', () => {
  test('returns a logs array on a fresh DB', async () => {
    const res = await combined.handle(req('/api/logs'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { logs: unknown };
    expect(Array.isArray(body.logs)).toBe(true);
  });
});

describe('GET /api/graph', () => {
  test('returns a response object', async () => {
    const res = await combined.handle(req('/api/graph?limit=5'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe('object');
  });
});

describe('GET /api/context', () => {
  test('returns a response object', async () => {
    const res = await combined.handle(req('/api/context'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe('object');
  });
});

describe('GET /api/plugins (combined app — files.ts handler wins)', () => {
  test('lists flat .wasm entries from PLUGINS_DIR', async () => {
    const res = await combined.handle(req('/api/plugins'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plugins: Array<{ name: string; file: string }> };
    expect(Array.isArray(body.plugins)).toBe(true);
    const names = body.plugins.map((p) => p.name);
    expect(names).toContain('alpha');
  });
});

describe('GET /api/plugins/:name (combined app)', () => {
  test('serves wasm bytes with application/wasm content-type', async () => {
    const res = await combined.handle(req('/api/plugins/alpha'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('wasm');
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.slice(0, 4)).toEqual(new Uint8Array([0x00, 0x61, 0x73, 0x6d]));
  });

  test('returns 404 for missing plugin', async () => {
    const res = await combined.handle(req('/api/plugins/no-such-plugin'));
    expect(res.status).toBe(404);
  });
});

describe('plugins.ts scanner (dual-layout, isolated)', () => {
  test('lists both flat and nested plugins', async () => {
    const res = await pluginsOnly.handle(req('/api/plugins'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dir: string;
      plugins: Array<{ name: string; file: string; version?: string }>;
    };
    expect(body.dir).toContain('.oracle');
    const names = body.plugins.map((p) => p.name).sort();
    expect(names).toContain('flat');
    expect(names).toContain('nested-plugin');
  });

  test('nested plugin resolves via basename fallback', async () => {
    const res = await pluginsOnly.handle(req('/api/plugins'));
    const body = (await res.json()) as {
      plugins: Array<{ name: string; file: string; version?: string }>;
    };
    const nested = body.plugins.find((p) => p.name === 'nested-plugin');
    expect(nested).toBeDefined();
    // manifest.wasm was an absolute path; scanner must have used basename.
    expect(nested!.file).toBe('nested-plugin.wasm');
    expect(nested!.version).toBe('2.0.0');
  });

  test('serves nested wasm bytes via basename fallback', async () => {
    const res = await pluginsOnly.handle(req('/api/plugins/nested-plugin'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('wasm');
  });

  test('strips special characters from :name before lookup', async () => {
    // `../flat` should be sanitized to `flat` (regex keeps \w.- only).
    const res = await pluginsOnly.handle(req('/api/plugins/..%2Fflat'));
    // Either 200 (sanitized to "flat") or 404 — never serves a traversal.
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.headers.get('content-type')).toContain('wasm');
    }
  });

  test('returns 404 for truly missing plugin', async () => {
    const res = await pluginsOnly.handle(req('/api/plugins/ghost'));
    expect(res.status).toBe(404);
  });
});
