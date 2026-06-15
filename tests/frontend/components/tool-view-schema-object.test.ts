import { describe, expect, test } from 'bun:test';
import { schemaText } from '../../../frontend/src/components/toolView';

describe('schemaText object schemas', () => {
  test('pretty-prints present schemas', () => {
    expect(schemaText({ name: 'echo', description: '', inputSchema: { type: 'object' } })).toBe('{\n  "type": "object"\n}');
  });
});
