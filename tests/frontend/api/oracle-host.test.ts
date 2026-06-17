import { afterEach, describe, expect, test } from 'bun:test';

type OracleModule = typeof import('../../../frontend/src/api/oracle');

type WindowStub = {
  history: { replaceState: (_state: unknown, _title: string, url?: string | URL | null) => void };
  localStorage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };
  location: { assign: (url: string) => void; hash: string; href: string; pathname: string; search: string };
};

const previousWindow = globalThis.window;
const previousFetch = globalThis.fetch;
let importCount = 0;

afterEach(() => {
  globalThis.window = previousWindow;
  globalThis.fetch = previousFetch;
});

function stubWindow(href: string, stored?: string) {
  const url = new URL(href);
  const store = new Map<string, string>();
  if (stored) store.set('oracle.host', stored);
  const replaces: string[] = [];
  const assigns: string[] = [];
  const win: WindowStub = {
    history: { replaceState: (_state, _title, next) => { replaces.push(String(next)); } },
    localStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
    location: { assign: (next) => assigns.push(next), hash: url.hash, href: url.href, pathname: url.pathname, search: url.search },
  };
  return { assigns, replaces, store, win };
}

async function importOracle(win: WindowStub): Promise<OracleModule> {
  globalThis.window = win as unknown as Window & typeof globalThis;
  importCount += 1;
  return import(`../../../frontend/src/api/oracle.ts?case=${importCount}`) as Promise<OracleModule>;
}

describe('Studio API host resolution', () => {
  test('normalizes ?host=, persists it, and removes only that query parameter', async () => {
    const page = stubWindow('https://god.buildwithoracle.com/vector?host=https://127.0.0.1:47779/api&pane=menu#dash');
    const oracle = await importOracle(page.win);

    expect(oracle.API_HOST).toBe('127.0.0.1:47779');
    expect(oracle.API_BASE).toBe('http://127.0.0.1:47779');
    expect(page.store.get('oracle.host')).toBe('127.0.0.1:47779');
    expect(page.replaces).toEqual(['/vector?pane=menu#dash']);
  });

  test('uses stored hosts, falls back to localhost, and adds PNA only for local addresses', async () => {
    const stored = await importOracle(stubWindow('https://god.buildwithoracle.com/', 'localhost:48888').win);
    const remote = await importOracle(stubWindow('https://god.buildwithoracle.com/?host=api.example.com').win);

    expect(stored.API_BASE).toBe('http://localhost:48888');
    expect(remote.API_BASE).toBe('http://api.example.com');
    expect((stored.withLocalPna({}) as RequestInit & { targetAddressSpace?: string }).targetAddressSpace).toBe('local');
    expect((remote.withLocalPna({}) as RequestInit & { targetAddressSpace?: string }).targetAddressSpace).toBeUndefined();
  });

  test('apiFetch targets the resolved local backend with targetAddressSpace local', async () => {
    const page = stubWindow('https://god.buildwithoracle.com/?host=localhost:47780');
    const calls: Array<{ init?: RequestInit; input: RequestInfo | URL }> = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return Promise.resolve(new Response('{}'));
    }) as typeof fetch;
    const oracle = await importOracle(page.win);

    await oracle.apiFetch('/api/health', { headers: { accept: 'application/json' } });

    expect(String(calls[0]?.input)).toBe('http://localhost:47780/api/health');
    expect((calls[0]?.init as RequestInit & { targetAddressSpace?: string })?.targetAddressSpace).toBe('local');
  });
});
