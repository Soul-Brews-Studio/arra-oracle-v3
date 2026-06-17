import { afterEach, describe, expect, test } from 'bun:test';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalFetch = globalThis.fetch;

type FakeWindow = {
  location: { href: string; assign: (url: string) => void };
  localStorage: Storage;
  history: { replaceState: (...args: unknown[]) => void };
  assigned?: string;
  replaced?: string;
};

function fakeStorage(seed: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(seed));
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  } as Storage;
}

function installWindow(href: string, stored: Record<string, string> = {}): FakeWindow {
  const fake = {
    location: { href, assign: (url: string) => { fake.assigned = url; } },
    localStorage: fakeStorage(stored),
    history: { replaceState: (_state: unknown, _title: unknown, url?: unknown) => { fake.replaced = String(url); } },
  } as FakeWindow;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fake });
  return fake;
}

async function loadOracleApi(label: string) {
  return import(`../../frontend/src/api/oracle.ts?host-test=${label}-${Date.now()}-${Math.random()}`);
}

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete (globalThis as { window?: unknown }).window;
  globalThis.fetch = originalFetch;
});

describe('Studio local Oracle host resolution', () => {
  test('?host persists, cleans the URL, and targets local API with PNA', async () => {
    const fake = installWindow('https://god.buildwithoracle.com/status?host=localhost:47778&tab=health#top');
    let captured: { input: RequestInfo | URL; init?: RequestInit } | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { input, init };
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch;

    const api = await loadOracleApi('query-localhost');
    expect(api.API_HOST).toBe('localhost:47778');
    expect(api.API_BASE).toBe('http://localhost:47778');
    expect(fake.localStorage.getItem(api.API_HOST_STORAGE_KEY)).toBe('localhost:47778');
    expect(fake.replaced).toBe('/status?tab=health#top');
    expect(api.apiUrl('/api/health')).toBe('http://localhost:47778/api/health');

    await api.apiFetch('/api/health', { headers: { accept: 'application/json' } });
    expect(String(captured?.input)).toBe('http://localhost:47778/api/health');
    expect((captured?.init as RequestInit & { targetAddressSpace?: string })?.targetAddressSpace).toBe('local');
  });

  test('stored host is reused when query param is absent', async () => {
    installWindow('https://god.buildwithoracle.com/', { 'oracle:host': '127.0.0.1:47778' });
    const api = await loadOracleApi('stored-host');
    expect(api.API_HOST).toBe('127.0.0.1:47778');
    expect(api.apiUrl('/api/v1/vector/config')).toBe('http://127.0.0.1:47778/api/v1/vector/config');
  });


  test('legacy stored host is migrated to oracle:host', async () => {
    const fake = installWindow('https://god.buildwithoracle.com/', { 'oracle.host': '127.0.0.1:47781' });
    const api = await loadOracleApi('legacy-stored-host');
    expect(api.API_HOST_STORAGE_KEY).toBe('oracle:host');
    expect(api.API_HOST).toBe('127.0.0.1:47781');
    expect(fake.localStorage.getItem('oracle:host')).toBe('127.0.0.1:47781');
  });

  test('remote hosts do not receive local PNA metadata', async () => {
    installWindow('https://god.buildwithoracle.com/?host=https://oracle.example.test/api');
    const api = await loadOracleApi('remote-host');
    expect(api.API_HOST).toBe('oracle.example.test');
    expect(api.withLocalPna({ method: 'GET' })).toEqual({ method: 'GET' });
  });

  test('connectToApiHost normalizes, persists, and redirects through ?host=', async () => {
    const fake = installWindow('https://god.buildwithoracle.com/dashboard?tab=vector#config');
    const api = await loadOracleApi('connect-host');
    api.connectToApiHost('http://localhost:47778/path');
    expect(fake.localStorage.getItem(api.API_HOST_STORAGE_KEY)).toBe('localhost:47778');
    expect(fake.assigned).toBe('/dashboard?tab=vector&host=localhost%3A47778#config');
  });

  test('absolute ?host values keep non-host query params while changing ports', async () => {
    const fake = installWindow('https://god.buildwithoracle.com/vector?pane=menu&host=https://127.0.0.1:47779/api#dash');
    const api = await loadOracleApi('absolute-host');
    expect(api.API_HOST).toBe('127.0.0.1:47779');
    expect(api.API_BASE).toBe('http://127.0.0.1:47779');
    expect(fake.localStorage.getItem(api.API_HOST_STORAGE_KEY)).toBe('127.0.0.1:47779');
    expect(fake.replaced).toBe('/vector?pane=menu#dash');
  });

  test('apiFetch targets a stored local backend with PNA metadata', async () => {
    installWindow('https://god.buildwithoracle.com/', { 'oracle:host': 'localhost:47780' });
    let captured: { input: RequestInfo | URL; init?: RequestInit } | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { input, init };
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const api = await loadOracleApi('stored-local-fetch');

    await api.apiFetch('/api/health', { headers: { accept: 'application/json' } });

    expect(String(captured?.input)).toBe('http://localhost:47780/api/health');
    expect((captured?.init as RequestInit & { targetAddressSpace?: string })?.targetAddressSpace).toBe('local');
  });

});
