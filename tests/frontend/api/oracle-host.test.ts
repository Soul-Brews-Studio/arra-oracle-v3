import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_ORACLE_HOST,
  ORACLE_HOST_STORAGE_KEY,
  normalizeOracleHost,
  oracleApiBaseForHost,
  resolveOracleApiBase,
  withOracleFetchInit,
  type OracleApiBaseEnvironment,
} from '../../../frontend/src/api/oracle';

function env(search = '', protocol = 'https:', stored?: string) {
  const values = new Map<string, string>();
  if (stored) values.set(ORACLE_HOST_STORAGE_KEY, stored);
  const replacements: string[] = [];
  const context: OracleApiBaseEnvironment = {
    isTauri: false,
    location: { protocol, search, pathname: '/studio', hash: '#dashboard' },
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
    },
    history: {
      replaceState: (_state: unknown, _unused: string, url?: string | URL | null) => { replacements.push(String(url)); },
    },
  };
  return { context, replacements, values };
}

describe('Studio Oracle API host resolution', () => {
  test('defaults HTTPS Studio to localhost while preserving HTTP dev proxy mode', () => {
    expect(resolveOracleApiBase(env('', 'https:').context)).toBe(oracleApiBaseForHost(DEFAULT_ORACLE_HOST));
    expect(resolveOracleApiBase(env('', 'http:').context)).toBe('');
  });

  test('normalizes ?host=, persists it, and removes only the host query param', () => {
    const scenario = env('?host=http://127.0.0.1:47779/api&pane=menu', 'https:');

    expect(resolveOracleApiBase(scenario.context)).toBe('http://127.0.0.1:47779');
    expect(scenario.values.get(ORACLE_HOST_STORAGE_KEY)).toBe('127.0.0.1:47779');
    expect(scenario.replacements).toEqual(['/studio?pane=menu#dashboard']);
  });

  test('uses the persisted host before the HTTPS default', () => {
    expect(resolveOracleApiBase(env('', 'https:', 'localhost:48888').context)).toBe('http://localhost:48888');
  });

  test('adds the Chrome Private Network Access fetch option for local HTTP API bases', () => {
    const localInit = withOracleFetchInit({ method: 'GET' }, 'http://localhost:47778');
    const proxyInit = withOracleFetchInit({ method: 'GET' }, '');

    expect(localInit.targetAddressSpace).toBe('local');
    expect(proxyInit.targetAddressSpace).toBeUndefined();
    expect(normalizeOracleHost('https://localhost:47778/api')).toBe('localhost:47778');
  });
});
