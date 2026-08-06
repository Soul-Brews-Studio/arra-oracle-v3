import { describe, expect, test } from 'bun:test';
import { MeterBar } from '../../../frontend/src/components/MeterBar';
import { htmlFor } from '../_render';

describe('MeterBar accessibility', () => {
  test('renders a bounded semantic meter with value text', () => {
    const html = htmlFor(<MeterBar label="Heap used" percent={142} tone="accent2" valueText="16 MB" />);
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('aria-valuetext="16 MB · 100%"');
    expect(html).toContain('bg-accent2-solid');
  });
});
