import { describe, expect, test } from 'bun:test';
import { schemaText } from '../../../frontend/src/components/toolView';

describe('schemaText', () => {
  test('pretty-prints missing schemas as an empty object', () => {
    expect(schemaText({ name: 'echo', description: 'Echo input' })).toBe('{}');
  });
});
