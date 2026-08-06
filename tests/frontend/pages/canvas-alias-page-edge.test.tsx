import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { CanvasAliasPage } from '../../../frontend/src/pages/CanvasAliasPage';
import { htmlFor } from '../_render';

describe('CanvasAliasPage render edges', () => {
  test('points the CTA and preview iframe at the requested standalone plugin', () => {
    const html = htmlFor(
      <MemoryRouter initialEntries={['/canvas?plugin=planets']}>
        <CanvasAliasPage />
      </MemoryRouter>,
    );

    expect(html).toContain('aria-labelledby="canvas-alias-title"');
    expect(html).toContain('Studio canvas alias');
    expect(html).toContain('Open standalone canvas');
    expect(html).toContain('href="https://canvas.buildwithoracle.com/planets"');
    expect(html).toContain('src="https://canvas.buildwithoracle.com/planets"');
    expect(html).toContain('title="canvas.buildwithoracle.com preview"');
  });
});
