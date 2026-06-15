import { describe, expect, test } from 'bun:test';
import { MetricsPage } from '../../../frontend/src/pages/MetricsPage';
import { htmlFor } from '../_render';

describe('MetricsPage loading state', () => {
  test('renders the versioned metrics loading endpoint', () => {
    const html = htmlFor(<MetricsPage metrics={null} loading />);
    expect(html).toContain('Loading metrics');
    expect(html).toContain('/api/v1/metrics');
  });
});
