import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configPath, loadVectorConfig } from '../../src/vector/config.ts';
import { VECTOR_PROXY_PROTOCOL_VERSION } from '../../src/vector/proxy-protocol.ts';
import { VectorServiceRegistry } from '../../src/vector/service-registry.ts';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const roots: string[] = [];

function useTempDataDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'vector-service-registry-'));
  roots.push(root);
  process.env.ORACLE_DATA_DIR = root;
  return root;
}

afterEach(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

test('VectorServiceRegistry registers and discovers configured vector backends', async () => {
  const root = useTempDataDir();
  const registry = new VectorServiceRegistry();

  await registry.register({
    name: ' turbovec ',
    type: 'proxy',
    endpoint: 'http://127.0.0.1:8082',
    capabilities: { protocol: 'vector-proxy-v1' },
  });

  expect(await registry.discover()).toEqual([
    { kind: 'vector', name: 'lancedb', type: 'builtin', endpoint: undefined, capabilities: undefined },
    { kind: 'vector', name: 'sqlite-vec', type: 'builtin', endpoint: undefined, capabilities: undefined },
    {
      kind: 'vector',
      name: 'turbovec',
      type: 'proxy',
      endpoint: 'http://127.0.0.1:8082',
      capabilities: { protocol: 'vector-proxy-v1' },
    },
  ]);
  expect(loadVectorConfig(configPath(root))?.storage?.services.turbovec).toMatchObject({
    type: 'proxy',
    endpoint: 'http://127.0.0.1:8082',
  });
});

test('VectorServiceRegistry healthCheck follows proxy /health status contract', async () => {
  useTempDataDir();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      return Response.json({ status: 'degraded', name: 'proxy-a', version: 'test' });
    },
  });

  try {
    const registry = new VectorServiceRegistry();
    await registry.register({ name: 'proxy-a', type: 'proxy', endpoint: String(server.url).replace(/\/$/, '') });
    const health = await registry.healthCheck();

    expect(health.get('proxy-a')).toMatchObject({
      status: 'down',
      name: 'proxy-a',
      version: 'test',
      error: 'health status degraded',
    });
  } finally {
    server.stop(true);
  }
});

test('VectorServiceRegistry verifies declared proxy protocol capability', async () => {
  useTempDataDir();
  let protocol = 'legacy-proxy';
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      return Response.json({ status: 'ok', name: 'proxy-a', version: 'test', protocol });
    },
  });

  try {
    const registry = new VectorServiceRegistry();
    await registry.register({
      name: 'proxy-a',
      type: 'proxy',
      endpoint: String(server.url).replace(/\/$/, ''),
      capabilities: { protocol: VECTOR_PROXY_PROTOCOL_VERSION },
    });

    const mismatch = await registry.healthCheck();
    expect(mismatch.get('proxy-a')).toMatchObject({
      status: 'down',
      protocol: 'legacy-proxy',
      error: `protocol mismatch: expected ${VECTOR_PROXY_PROTOCOL_VERSION}, got legacy-proxy`,
    });

    protocol = VECTOR_PROXY_PROTOCOL_VERSION;
    const healthy = await registry.healthCheck();
    expect(healthy.get('proxy-a')).toMatchObject({
      status: 'up',
      protocol: VECTOR_PROXY_PROTOCOL_VERSION,
    });
  } finally {
    server.stop(true);
  }
});

test('VectorServiceRegistry drops non-record capabilities before persisting', async () => {
  useTempDataDir();
  const registry = new VectorServiceRegistry();

  const service = await registry.register({
    name: 'arraycaps',
    type: 'builtin',
    capabilities: ['not', 'record'] as any,
  });

  expect(service).toEqual({ kind: 'vector', name: 'arraycaps', type: 'builtin', endpoint: undefined });
  expect((await registry.discover()).find((item) => item.name === 'arraycaps')?.capabilities).toBeUndefined();
});
