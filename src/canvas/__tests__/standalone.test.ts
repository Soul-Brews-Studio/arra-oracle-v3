import { describe, expect, test } from 'bun:test';

import { DEFAULT_CANVAS_PORT, parseCanvasServeOptions } from '../standalone.ts';

describe('canvas standalone option parsing', () => {
  test('rejects flags that are missing values', () => {
    expect(() => parseCanvasServeOptions(['--port'])).toThrow('--port requires a value');
    expect(() => parseCanvasServeOptions(['--api-base='])).toThrow('--api-base requires a value');
    expect(() => parseCanvasServeOptions(['--host'])).toThrow('--host requires a value');
  });

  test('trims flag values and ignores blank environment defaults', () => {
    const parsed = parseCanvasServeOptions([
      '--port',
      ' 47780 ',
      '--api-base',
      ' https://api.example.test/ ',
      '--host',
      ' 127.0.0.1 ',
    ]);
    expect(parsed).toEqual({
      port: 47780,
      apiBase: 'https://api.example.test/',
      hostname: '127.0.0.1',
    });

    expect(parseCanvasServeOptions([], {
      CANVAS_PORT: ' ',
      CANVAS_HOST: ' ',
      ORACLE_API_BASE: ' ',
    })).toEqual({
      port: DEFAULT_CANVAS_PORT,
      apiBase: undefined,
      hostname: '0.0.0.0',
    });
  });
});
