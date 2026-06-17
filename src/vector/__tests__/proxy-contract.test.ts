import { describe, expect, test } from 'bun:test';
import {
  VECTOR_PROXY_DEFAULT_TIMEOUT_MS,
  VECTOR_PROXY_PROTOCOL_VERSION,
  requireVectorProxyContract,
  resolveVectorProxyContract,
  vectorProxyRouteUrls,
} from '../proxy-contract.ts';

const emptyEnv: Record<string, string | undefined> = {};

describe('vector proxy contract', () => {
  test('resolves backend to separate vector server endpoint from explicit config', () => {
    const contract = resolveVectorProxyContract({
      endpoint: ' https://vectors.example.test/root/ ',
      backend: 'qdrant',
      collectionName: 'oracle_knowledge',
      timeoutMs: 20_500.8,
      env: emptyEnv,
    });

    expect(contract).toMatchObject({
      protocol: VECTOR_PROXY_PROTOCOL_VERSION,
      baseUrl: 'https://vectors.example.test/root',
      backend: 'qdrant',
      collectionName: 'oracle_knowledge',
      timeoutMs: 20_500,
      healthTimeoutMs: 5_000,
    });
    expect(vectorProxyRouteUrls(contract!).query).toBe('https://vectors.example.test/root/vectors/query');
  });

  test('uses env aliases and strips credentials/fragments from endpoint', () => {
    const contract = resolveVectorProxyContract({
      env: {
        VECTOR_DB_URL: 'http://user:pass@127.0.0.1:8081/vector#secret',
        ORACLE_PROXY_VECTOR_TIMEOUT_MS: '9000',
      },
    });

    expect(contract?.baseUrl).toBe('http://127.0.0.1:8081/vector');
    expect(contract?.timeoutMs).toBe(9_000);
  });

  test('prefers ORACLE_PROXY_VECTOR_URL over generic VECTOR_DB_URL', () => {
    const contract = resolveVectorProxyContract({
      env: {
        ORACLE_PROXY_VECTOR_URL: 'https://proxy.example.test',
        VECTOR_DB_URL: 'https://ignored.example.test',
      },
    });

    expect(contract?.baseUrl).toBe('https://proxy.example.test');
  });

  test('rejects missing or non-http endpoints and keeps sane timeout default', () => {
    expect(resolveVectorProxyContract({ endpoint: 'file:///tmp/vector.sock', env: emptyEnv })).toBeNull();
    expect(resolveVectorProxyContract({ env: { ORACLE_PROXY_VECTOR_TIMEOUT_MS: '-1' } })).toBeNull();
    expect(resolveVectorProxyContract({ endpoint: 'http://localhost:8081', env: { ORACLE_PROXY_VECTOR_TIMEOUT_MS: 'nope' } })?.timeoutMs)
      .toBe(VECTOR_PROXY_DEFAULT_TIMEOUT_MS);
    expect(() => requireVectorProxyContract({ env: emptyEnv })).toThrow('Vector proxy endpoint requires');
  });
});
