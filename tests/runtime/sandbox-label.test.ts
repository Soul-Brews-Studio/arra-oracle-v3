import { describe, expect, test } from 'bun:test';
import { SANDBOX_LABEL_HEADER, sandboxLabel } from '../../src/runtime/sandbox-label.ts';

describe('runtime sandbox label', () => {
  test('keeps the shared response header stable', () => {
    expect(SANDBOX_LABEL_HEADER).toBe('X-Sandbox-Label');
  });

  test('normalizes supported production and staging aliases', () => {
    expect(sandboxLabel(' production ')).toBe('prod');
    expect(sandboxLabel('PROD')).toBe('prod');
    expect(sandboxLabel(' staging ')).toBe('staging');
    expect(sandboxLabel('STAGE')).toBe('staging');
  });

  test('maps development-like environments to dev', () => {
    for (const value of ['development', 'dev', 'local', 'test']) {
      expect(sandboxLabel(value)).toBe('dev');
    }
  });

  test('falls back to dev for empty, unknown, and non-string values', () => {
    for (const value of ['', '   ', 'preview', undefined, null, 42, { env: 'production' }]) {
      expect(sandboxLabel(value)).toBe('dev');
    }
  });
});
