import { expect, test } from 'bun:test';
import { probeVectorStore } from '../../src/mcp/vector-health.ts';
import type { VectorStoreAdapter } from '../../src/vector/types.ts';

test('MCP probe opens its session-owned store before checking health', async () => {
  let connected = false;
  const store = {
    name: 'probe-fixture',
    async connect() { connected = true; },
    async getStats() {
      if (!connected) throw new Error('not connected');
      return { count: 1 };
    },
  } as VectorStoreAdapter;
  expect(await probeVectorStore(store, 'unknown')).toBe('connected');
  expect(await probeVectorStore(store, 'degraded')).toBe('degraded');
});
