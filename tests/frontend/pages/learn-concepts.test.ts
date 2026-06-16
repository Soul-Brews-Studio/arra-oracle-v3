import { describe, expect, test } from 'bun:test';
import { conceptsFromInput } from '../../../frontend/src/pages/LearnPage';

describe('conceptsFromInput', () => {
  test('trims comma-separated concepts and drops empties', () => {
    expect(conceptsFromInput(' learn, ui ,, oracle ')).toEqual(['learn', 'ui', 'oracle']);
  });
});
