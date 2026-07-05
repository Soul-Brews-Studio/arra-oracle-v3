import { describe, expect, test } from 'bun:test';
import { GraphPreview } from '../../../../frontend/src/components/export/GraphPreview';
import { htmlFor } from '../../_render';

describe('GraphPreview', () => {
  test('renders graph svg, relationship titles, and hidden-node summary', () => {
    const html = htmlFor(
      <GraphPreview
        data={{
          nodes: [
            { id: 'a', label: 'Alpha memory', type: 'memory' },
            { id: 'b', label: 'Beta concept', type: 'concept' },
            { id: 'c', label: 'Gamma trace', type: 'trace' },
          ],
          relationships: [{ type: 'mentions', from: 'a', to: 'b' }],
        }}
        iterations={1}
        maxNodes={2}
        title="Export graph preview"
      />,
    );

    expect(html).toContain('Export graph preview');
    expect(html).toContain('2 nodes and 1 edges shown, 1 hidden');
    expect(html).toContain('role="img"');
    expect(html).toContain('mentions: a to b');
    expect(html).toContain('Alpha memory');
    expect(html).toContain('Beta concept');
    expect(html).not.toContain('Gamma trace');
  });
});
