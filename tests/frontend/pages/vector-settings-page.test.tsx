import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { VectorSettingsPage } from '../../../frontend/src/pages/VectorSettingsPage';
import { htmlFor } from '../_render';

describe('VectorSettingsPage', () => {
  test('composes vector search, provider, storage, adapter, model guidance, and index panels', () => {
    const html = htmlFor(<MemoryRouter><VectorSettingsPage /></MemoryRouter>);
    expect(html).toContain('Vector settings');
    expect(html).toContain('Enable vector search');
    expect(html).toContain('PATCH /api/v1/vector/config');
    expect(html).toContain('First-run wizard');
    expect(html).toContain('Provider → vault → first index');
    expect(html).toContain('Open Index Manager');
    expect(html).toContain('Embedding providers and storage services');
    expect(html).toContain('Model recommendation');
    expect(html).toContain('Active vector adapters');
    expect(html).toContain('edit model/provider');
    expect(html).toContain('set primary');
    expect(html).toContain('Index jobs and collections');
  });
});
