/** A collection never inherits another engine's store path (LanceDB tables landed in a dir named vectors.db). */
import { describe, expect, test } from 'bun:test';
import { configToModels } from '../config-models.ts';
import type { VectorServerConfig } from '../config-types.ts';

const base = (dataPath: string, adapter: string, own?: string) => ({
  version: '1.0', enabled: false, host: '127.0.0.1', port: 8081, dataPath,
  collections: { c: { collection: 'x', model: 'm', provider: 'ollama', adapter, ...(own ? { dataPath: own } : {}) } },
}) as unknown as VectorServerConfig;

describe('collection dataPath', () => {
  test('LanceDB collection under the sqlite-vec default gets <data>/lancedb, not vectors.db', () => {
    expect(configToModels(base('/d/vectors.db', 'lancedb')).c.dataPath).toBe('/d/lancedb');
  });
  test('sqlite-vec collection under a LanceDB default gets <data>/vectors.db', () => {
    expect(configToModels(base('/d/lancedb', 'sqlite-vec')).c.dataPath).toBe('/d/vectors.db');
  });
  test('same engine inherits; an explicit path always wins', () => {
    expect(configToModels(base('/d/vectors.db', 'sqlite-vec')).c.dataPath).toBe('/d/vectors.db');
    expect(configToModels(base('/d/vectors.db', 'lancedb', '/x/lance')).c.dataPath).toBe('/x/lance');
  });
});
