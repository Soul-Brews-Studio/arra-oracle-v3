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

  test('treats blank path env as unset during validation', () => {
    const result = validateEnv({
      env: { HOME: '/tmp/arra-home', ORACLE_DATA_DIR: '   ', ORACLE_VECTOR_DB_PATH: '   ' },
      emitOptionalWarnings: false,
    });

    expect(result.warnings).toContain('ORACLE_DATA_DIR is unset; using ~/.arra-oracle-v2.');
  });

  test('rejects invalid port range before server startup', () => {
    expect(() => validateEnv({ env: { HOME: '/tmp/arra-home', PORT: '70000' }, emitOptionalWarnings: false }))
      .toThrow(/PORT must be <= 65535/);
  });

  test('trims scalar values before validating edge-case env', () => {
    const result = validateEnv({
      env: {
        HOME: '/tmp/arra-home',
        LOG_FORMAT: ' JSON ',
        PORT: ' 0 ',
        ORACLE_GATEWAY_HOT_RELOAD: ' on ',
        VECTOR_URL: ' https://vectors.example.test ',
        DATABASE_URL: ' file:///tmp/arra-edge.db ',
      },
      emitOptionalWarnings: false,
    });

    expect(result.env.PORT).toBe(' 0 ');
  });

  test('rejects unknown LOG_FORMAT values before logger startup', () => {
    expect(() => validateEnv({ env: { HOME: '/tmp/arra-home', LOG_FORMAT: 'verbose' }, emitOptionalWarnings: false }))
      .toThrow(/LOG_FORMAT must be one of nginx, json, short/);
    expect(validateEnv({ env: { HOME: '/tmp/arra-home', LOG_FORMAT: 'JSON' }, emitOptionalWarnings: false }).env.LOG_FORMAT)
      .toBe('JSON');
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

  test('requires provider credentials for remote embedding backends', () => {
    expect(() => validateEnv({ env: { HOME: '/tmp/arra-home', ORACLE_EMBEDDER: 'remote' }, emitOptionalWarnings: false }))
      .toThrow(/Remote embedder requires ORACLE_EMBEDDER_URL or ORACLE_REMOTE_EMBEDDING_URL/);
    expect(() => validateEnv({ env: { HOME: '/tmp/arra-home', ORACLE_EMBEDDER: 'openai' }, emitOptionalWarnings: false }))
      .toThrow(/OpenAI embedder requires OPENAI_API_KEY/);
    expect(() => validateEnv({ env: { HOME: '/tmp/arra-home', ORACLE_VECTOR_DB: 'cloudflare-vectorize' }, emitOptionalWarnings: false }))
      .toThrow(/Cloudflare vector\/AI config requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN/);
  });

  test('rejects non-http remote service URLs clearly', () => {
    expect(() => validateEnv({
      env: { HOME: '/tmp/arra-home', ORACLE_VECTOR_DB: 'proxy', ORACLE_PROXY_VECTOR_URL: 'ftp://vectors' },
      emitOptionalWarnings: false,
    })).toThrow(/ORACLE_PROXY_VECTOR_URL must be a valid http\(s\) URL/);
    expect(() => validateEnv({
      env: { HOME: '/tmp/arra-home', ORACLE_HTTP_URL: 'file:///tmp/oracle.sock' },
      emitOptionalWarnings: false,
    })).toThrow(/ORACLE_HTTP_URL must be a valid http\(s\) URL or "embedded"/);
    expect(() => validateEnv({
      env: { HOME: '/tmp/arra-home', ORACLE_ORIGIN_URL: 'file:///tmp/oracle.sock' },
      emitOptionalWarnings: false,
    })).toThrow(/ORACLE_ORIGIN_URL must be a valid http\(s\) URL/);
  });

  test('accepts provider env aliases during startup validation', () => {
    const env = {
      HOME: '/tmp/arra-home',
      ORACLE_EMBEDDER: 'gemini',
      GOOGLE_API_KEY: 'google-gemini-key',
      OLLAMA_HOST: 'ollama.internal:11434',
    };
    expect(validateEnv({ env, emitOptionalWarnings: false }).env.GOOGLE_API_KEY).toBe('google-gemini-key');
  });
});
