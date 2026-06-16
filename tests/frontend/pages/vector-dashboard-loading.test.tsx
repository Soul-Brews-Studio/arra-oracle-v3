import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { VectorPage } from '../../../frontend/src/pages/VectorPage';
import { htmlFor } from '../_render';

describe('VectorPage loading state', () => {
  test('shows the vector status endpoints while loading', () => {
    const html = htmlFor(<MemoryRouter><VectorPage /></MemoryRouter>);
    expect(html).toContain('Loading vector status');
    expect(html).toContain('/api/v1/vector/index/models and /api/v1/vector/health');
  });
});
