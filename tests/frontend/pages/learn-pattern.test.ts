import { describe, expect, test } from 'bun:test';
import { learnPayload, patternFromForm } from '../../../frontend/src/pages/LearnPage';

describe('learn form payload', () => {
  test('combines title and content into the learn pattern payload', () => {
    const form = { title: 'Title', content: 'Body', concepts: 'one, two' };
    expect(patternFromForm(form)).toBe('Title\n\nBody');
    expect(learnPayload(form)).toEqual({ pattern: 'Title\n\nBody', concepts: ['one', 'two'], source: 'Oracle Learn UI' });
  });
});
