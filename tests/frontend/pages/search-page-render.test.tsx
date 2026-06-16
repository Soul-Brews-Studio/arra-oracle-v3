import { describe, expect, test } from 'bun:test';
import { SearchPage } from '../../../frontend/src/pages/SearchPage';
import { htmlFor } from '../_render';

describe('Search page', () => {
  test('renders search helper text and global search form', () => {
    expect(htmlFor(<SearchPage />)).toContain('Search surfaces');
    expect(htmlFor(<SearchPage />)).toContain('Search all surfaces');
  });
});
