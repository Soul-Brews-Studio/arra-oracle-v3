import { describe, expect, test } from 'bun:test';
import App from '../../../frontend/src/App';
import { AppRouter } from '../../../frontend/src/router';
import { htmlFor, installBrowserLocation } from '../_render';

describe('App shell render', () => {
  test('renders the dashboard shell at the menu route before data loads', () => {
    const restore = installBrowserLocation('/menu');
    try {
      const html = htmlFor(<AppRouter><App /></AppRouter>);
      expect(html).toContain('Control Surface');
      expect(html).toContain('Menu viewer');
      expect(html).toContain('Arra Oracle');
      expect(html).toContain('Loading menu items');
    } finally {
      restore();
    }
  });
});
