import { describe, expect, test } from 'bun:test';
import { StatusPage } from '../../../frontend/src/pages/StatusPage';
import { htmlFor } from '../_render';

describe('StatusPage loading and error edges', () => {
  test('shows health loading copy before either health endpoint resolves', () => {
    const html = htmlFor(<StatusPage client={{ health: async () => { throw new Error('unused in SSR'); } }} />);

    expect(html).toContain('Health overview');
    expect(html).toContain('role="status" aria-label="Loading server health…"');
    expect(html).toContain('Fetching /api/v1/health from the Elysia backend.');
    expect(html).not.toContain('Plugin health');
  });
});
