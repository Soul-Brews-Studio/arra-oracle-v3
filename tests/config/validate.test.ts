import { describe, expect, test } from 'bun:test';
import { ConfigValidationError, validateEnv } from '../../src/config/validate.ts';

describe('config env validation', () => {
  test('throws a clear error when required path env is missing', () => {
    expect(() => validateEnv({ env: {}, emitOptionalWarnings: false })).toThrow(ConfigValidationError);
    expect(() => validateEnv({ env: {}, emitOptionalWarnings: false })).toThrow(/HOME or USERPROFILE is required/);
  });

  test('warns when optional startup env uses defaults', () => {
    const warnings: string[] = [];
    const result = validateEnv({ env: { HOME: '/tmp/arra-home' }, warn: (message) => warnings.push(message) });

    expect(result.warnings).toContain('ORACLE_PORT/PORT is unset; using 47778.');
    expect(result.warnings).toContain('VECTOR_URL is unset; using local vector adapter.');
    expect(warnings).toContain('[Config] ORACLE_PORT/PORT is unset; using 47778.');
  });
});
