import { describe, expect, test } from 'bun:test';
import { VectorStorageSelector } from '../../../frontend/src/components/VectorStorageSelector';
import type { VectorService } from '../../../frontend/src/api/oracle';
import { htmlFor } from '../_render';

const services: VectorService[] = [
  { name: 'lancedb', type: 'builtin', health: { status: 'up' } },
  { name: 'qdrant', type: 'proxy', health: { status: 'up' } },
  { name: 'turbovec', type: 'proxy', health: { status: 'down' } },
];

describe('VectorStorageSelector', () => {
  test('renders backend options and healthy service counts', () => {
    const html = htmlFor(<VectorStorageSelector services={services} />);

    expect(html).toContain('Storage Backend selector');
    expect(html).toContain('LanceDB (built-in)');
    expect(html).toContain('Qdrant (external)');
    expect(html).toContain('TurboVec (external)');
    expect(html).toContain('Cloudflare Vectorize');
    expect(html).toContain('Vector count available from 2 healthy built-in/service registry entries.');
    expect(html).toContain('Use [+ Register Service] below');
  });
});
