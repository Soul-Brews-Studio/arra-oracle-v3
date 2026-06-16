import { describe, expect, test } from 'bun:test';
import { VectorConfigPanel } from '../../../frontend/src/components/VectorConfigPanel';
import { VectorSearchToggle } from '../../../frontend/src/components/VectorSearchToggle';
import { htmlFor } from '../_render';

describe('vector config component loading shells', () => {
  test('renders vector config actions before async collections load', () => {
    const html = htmlFor(<VectorConfigPanel />);

    expect(html).toContain('Vector config');
    expect(html).toContain('Active vector adapters');
    expect(html).toContain('Source loading · engine loading · primary none · not ready');
    expect(html).toContain('Reloading');
    expect(html).not.toContain('No vector collections configured.');
  });

  test('renders disabled vector search controls before config loads', () => {
    const html = htmlFor(<VectorSearchToggle />);

    expect(html).toContain('Vector Search panel');
    expect(html).toContain('Enable vector search');
    expect(html).toContain('Loading vector search switch…');
    expect(html).toContain('Backend adapter');
    expect(html).toContain('disabled=""');
  });
});
