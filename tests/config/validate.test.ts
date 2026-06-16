import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  test('rejects invalid port range before server startup', () => {
    expect(() => validateEnv({ env: { HOME: '/tmp/arra-home', PORT: '70000' }, emitOptionalWarnings: false }))
      .toThrow(/PORT must be <= 65535/);
  });

  test('rejects directory database paths with a clear message', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arra-config-db-'));
    expect(() => validateEnv({ env: { HOME: '/tmp/arra-home', ORACLE_DB_PATH: dir }, emitOptionalWarnings: false }))
      .toThrow(/ORACLE_DB_PATH\/DATABASE_URL must be a file path/);
  });

  test('rejects file paths for LanceDB vector storage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arra-config-vector-'));
    const file = join(dir, 'not-a-dir');
    writeFileSync(file, 'x');
    expect(() => validateEnv({ env: { HOME: '/tmp/arra-home', ORACLE_VECTOR_DB: 'lancedb', ORACLE_VECTOR_DB_PATH: file }, emitOptionalWarnings: false }))
      .toThrow(/ORACLE_VECTOR_DB_PATH must be a directory/);
  });

  test('requires connection settings for remote vector backends', () => {
    expect(() => validateEnv({ env: { HOME: '/tmp/arra-home', ORACLE_VECTOR_DB: 'qdrant' }, emitOptionalWarnings: false }))
      .toThrow(/Qdrant vector DB requires QDRANT_URL/);
    expect(() => validateEnv({ env: { HOME: '/tmp/arra-home', ORACLE_VECTOR_DB: 'proxy' }, emitOptionalWarnings: false }))
      .toThrow(/Proxy vector DB requires ORACLE_PROXY_VECTOR_URL/);
  });
});
