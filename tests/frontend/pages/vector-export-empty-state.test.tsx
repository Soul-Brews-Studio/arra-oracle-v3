import { describe, expect, test } from 'bun:test';
import { VectorExportPage } from '../../../frontend/src/pages/VectorExportPage';
import { htmlFor } from '../_render';

describe('VectorExportPage empty interaction state', () => {
  test('keeps export disabled when no collections or formats are available', () => {
    const html = htmlFor(<VectorExportPage modelsResponse={{ models: {} }} loading={false} formats={[]} />);

    expect(html).toContain('Vector export');
    expect(html).toContain('No collections loaded');
    expect(html).toContain('No vector collections are available to export.');
    expect(html).toContain('aria-label="Export collection"');
    expect(html).toContain('aria-label="Export format"');
    expect(html).toContain('<button class="focus-ring rounded-xl border border-[color:var(--color-accent,#0f766e)]');
    expect(html).toContain('disabled=""');
  });
});
