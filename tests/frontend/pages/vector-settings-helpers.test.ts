import { describe, expect, test } from 'bun:test';
import { parseVectorConfigResponse, toRows } from '../../../frontend/src/pages/vectorSettingsHelpers';

describe('vector settings helpers', () => {
  test('preserves service registry endpoint metadata for proxy adapters', () => {
    const rows = toRows(parseVectorConfigResponse({
      source: 'file',
      engine: 'proxy',
      enabled: true,
      config: {
        version: '2',
        host: '127.0.0.1',
        port: 47778,
        dataPath: '/tmp/vector',
        embeddingEndpoint: '',
        collections: {
          turbo: {
            collection: 'oracle_turbo',
            model: 'bge-m3',
            provider: 'ollama',
            adapter: 'proxy',
            service: 'turbovec',
            endpoint: 'http://127.0.0.1:8082',
          },
        },
      },
      doc_counts: { turbo: 12 },
      health: {},
    }));

    expect(rows).toMatchObject([{
      key: 'turbo',
      adapter: 'proxy',
      service: 'turbovec',
      endpoint: 'http://127.0.0.1:8082',
      count: 12,
    }]);
  });
});
