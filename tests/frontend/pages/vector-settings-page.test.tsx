import { describe, expect, test } from 'bun:test';
import { VectorSettingsPage } from '../../../frontend/src/pages/VectorSettingsPage';
import { htmlFor } from '../_render';

describe('VectorSettingsPage', () => {
  test('composes vector search, provider, storage, adapter, model guidance, and index panels', () => {
    const html = htmlFor(<VectorSettingsPage />);
    expect(html).toContain('Vector settings');
    expect(html).toContain('Enable vector search');
    expect(html).toContain('PATCH /api/v1/vector/config');
    expect(html).toContain('Embedding providers and storage services');
    expect(html).toContain('Model recommendation');
    expect(html).toContain('Active vector adapters');
    expect(html).toContain('edit model/provider');
    expect(html).toContain('set primary');
    expect(html).toContain('Index jobs and collections');
  });
});
