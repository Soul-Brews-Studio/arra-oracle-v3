import { describe, expect, test } from 'bun:test';
import { loadLearnEntries } from '../../../frontend/src/pages/LearnPage';

describe('loadLearnEntries', () => {
  test('returns learn list items from the API client', async () => {
    const items = [{ id: 'learning-1', title: 'One', content: 'Body', concepts: [], sourceFile: 'one.md', createdAt: 1, updatedAt: 1 }];
    await expect(loadLearnEntries({ learn: async () => ({ items, total: 1 }) })).resolves.toBe(items);
  });
});
