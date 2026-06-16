import { describe, expect, test } from 'bun:test';
import { ConnectionTest, normalizeCollections } from '../../../../frontend/src/components/export/ConnectionTest';
import { htmlFor } from '../../_render';

describe('export ConnectionTest', () => {
  test('normalizes collection payloads with doc counts', () => {
    expect(normalizeCollections({
      collections: [
        { key: 'nomic', docs: '7' },
        { name: 'bge-m3', docCount: 42 },
      ],
    })).toEqual([
      { name: 'bge-m3', count: 42, description: undefined },
      { name: 'nomic', count: 7, description: undefined },
    ]);
  });

  test('renders the default backend connection controls', () => {
    const html = htmlFor(
      <ConnectionTest initialBackendUrl="localhost:47778" fetcher={async () => Response.json({})} />,
    );

    expect(html).toContain('Backend connection');
    expect(html).toContain('Not tested');
    expect(html).toContain('http://localhost:47778');
  });
});
