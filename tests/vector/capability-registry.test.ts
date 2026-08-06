import { expect, test } from 'bun:test';
import { CapabilityRegistry } from '../../src/vector/registry.ts';

test('CapabilityRegistry keeps registrations keyed by kind and name', async () => {
  const registry = new CapabilityRegistry<{ kind: string; name: string; capabilities?: Record<string, unknown> }, { ok: boolean }>({
    vector: async (entry) => ({ ok: entry.name === 'proxy-a' }),
    mcp: async () => ({ ok: true }),
  });

  registry.register({ kind: 'vector', name: 'proxy-a', capabilities: { protocol: 'vector-proxy-v1' } });
  registry.register({ kind: 'mcp', name: 'proxy-a' });

  expect(registry.discover('vector')).toEqual([
    { kind: 'vector', name: 'proxy-a', capabilities: { protocol: 'vector-proxy-v1' } },
  ]);
  expect(registry.discover().map((item) => `${item.kind}:${item.name}`)).toEqual([
    'mcp:proxy-a',
    'vector:proxy-a',
  ]);

  const vectorHealth = await registry.healthCheck('vector');
  expect(vectorHealth.get('proxy-a')).toEqual({ ok: true });
  const allHealth = await registry.healthCheck();
  expect(allHealth.get('vector:proxy-a')).toEqual({ ok: true });
  expect(allHealth.get('mcp:proxy-a')).toEqual({ ok: true });
});
