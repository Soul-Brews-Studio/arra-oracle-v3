import { describe, expect, test } from 'bun:test';
import { formFromEntry } from '../../../frontend/src/pages/LearnPage';
import type { LearnEntry } from '../../../frontend/src/types';

describe('formFromEntry', () => {
  test('preloads edit form fields from a learn entry', () => {
    const entry: LearnEntry = { id: 'id', title: 'Title', content: 'Body', concepts: ['a', 'b'], sourceFile: 'id.md', createdAt: 1, updatedAt: 2 };
    expect(formFromEntry(entry)).toEqual({ title: 'Title', content: 'Body', concepts: 'a, b' });
  });
});
