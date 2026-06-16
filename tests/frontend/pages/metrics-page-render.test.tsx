import { describe, expect, test } from 'bun:test';
import { MetricsPage } from '../../../frontend/src/pages/MetricsPage';
import { htmlFor } from '../_render';

describe('Metrics page', () => {
  test('renders runtime metrics labels', () => {
    expect(
      htmlFor(
        <MetricsPage menuCount={3} pluginCount={4} surfaceCount={5} updatedAt="12:00:00 PM" />,
      ),
    ).toContain('Runtime metrics');
    expect(htmlFor(<MetricsPage menuCount={3} pluginCount={4} surfaceCount={5} updatedAt="12:00:00 PM" />)).toContain('Runtime metrics');
  });
});
