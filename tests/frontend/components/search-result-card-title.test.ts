import { describe, expect, test } from 'bun:test';
import { titleFor } from '../../../frontend/src/components/searchResultView';

describe('titleFor', () => {
  test('prefers title, then source file, then id', () => {
    expect(titleFor({ id: 'id', content: '', title: 'Title', source_file: 'file.md' })).toBe('Title');
    expect(titleFor({ id: 'id', content: '', source_file: 'file.md' })).toBe('file.md');
    expect(titleFor({ id: 'id', content: '' })).toBe('id');
  });
});
