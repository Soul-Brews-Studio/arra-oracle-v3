import { describe, expect, test } from 'bun:test';
import { learnSummary } from '../../../frontend/src/pages/LearnPage';

describe('learnSummary', () => {
  test('describes loading, saving, error, empty, and populated states', () => {
    expect(learnSummary('loading', 0)).toContain('/api/v1/learn');
    expect(learnSummary('saving', 1)).toBe('Saving learn entry…');
    expect(learnSummary('error', 0)).toBe('Learn entries could not be loaded.');
    expect(learnSummary('ready', 0)).toBe('No learn entries yet.');
    expect(learnSummary('ready', 2)).toBe('2 active learn entries.');
  });
});
