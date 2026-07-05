import { describe, expect, test } from 'bun:test';
import {
  BackendGate,
  BrowserHealthError,
  ConnectOracleSetup,
  browserHealthCheck,
  connectUrlForHost,
  normalizeOracleHost,
} from '../../../frontend/src/components/BackendGate';
import { htmlFor, installBrowserLocation } from '../_render';

describe('BackendGate shell', () => {
  test('keeps app content hidden while the backend health check is pending', () => {
    const html = htmlFor(
      <BackendGate>
        <p>Loaded dashboard</p>
      </BackendGate>,
    );

    expect(html).toContain('Connect to your Oracle');
    expect(html).toContain('Checking backend health at http://localhost:47778.');
    expect(html).toContain('Local Oracle host');
    expect(html).toContain('Use this backend');
    expect(html).toContain('Retry');
    expect(html).not.toContain('Loaded dashboard');
    expect(html).not.toContain('Start Backend');
  });

  test('renders unreachable setup guidance with default local host', () => {
    const restore = installBrowserLocation('/?host=oracle.local:47778');
    try {
      const html = htmlFor(
        <ConnectOracleSetup
          isTauri
          message="fetch failed"
          onRetry={() => {}}
          onStartBackend={() => {}}
          starting={false}
          state="unreachable"
        />,
      );

      expect(html).toContain('Backend unavailable');
      expect(html).toContain('Cannot reach http://localhost:47778: fetch failed');
      expect(html).toContain('value="localhost:47778"');
      expect(html).toContain('arra-oracle-v3 serve');
      expect(html).toContain('Start Backend');
    } finally {
      restore();
    }
  });

  test('normalizes connect host URLs for the api/oracle host resolver', () => {
    expect(normalizeOracleHost(' https://localhost:47778/api/ ')).toBe('localhost:47778');
    expect(normalizeOracleHost('oracle.local:47778///')).toBe('oracle.local:47778');
    expect(connectUrlForHost('http://localhost:47778/api', 'https://god.buildwithoracle.com/vector?q=1'))
      .toBe('https://god.buildwithoracle.com/vector?q=1&host=localhost%3A47778');
  });

  test('connect URL replacement preserves unrelated search params and hash', () => {
    const href = 'https://god.buildwithoracle.com/vector?host=old%3A47778&pane=menu#docs';

    expect(connectUrlForHost(' https://127.0.0.1:47779/api ', href))
      .toBe('https://god.buildwithoracle.com/vector?host=127.0.0.1%3A47779&pane=menu#docs');
    expect(normalizeOracleHost('')).toBe('localhost:47778');
  });

  test('non-Tauri setup hides backend start while keeping retry and connect controls', () => {
    const html = htmlFor(
      <ConnectOracleSetup
        isTauri={false}
        message="offline"
        onRetry={() => {}}
        onStartBackend={() => {}}
        starting={false}
        state="unreachable"
      />,
    );

    expect(html).toContain('Backend unavailable');
    expect(html).toContain('Cannot reach http://localhost:47778: offline');
    expect(html).toContain('Use this backend');
    expect(html).toContain('Retry');
    expect(html).toContain('The real Chrome prompt appears here.');
    expect(html).not.toContain('Start Backend');
  });

  test('CORS setup hides the decorative PNA prompt and points at ARRA_CORS_ORIGINS', () => {
    const html = htmlFor(
      <ConnectOracleSetup
        accessIssue="cors"
        isTauri={false}
        message="Reached http://localhost:47778/api/health, but this origin is not trusted"
        onRetry={() => {}}
        onStartBackend={() => {}}
        starting={false}
        state="unreachable"
      />,
    );

    expect(html).toContain('Backend unavailable');
    expect(html).toContain('ARRA_CORS_ORIGINS');
    expect(html).toContain('this Studio origin is not trusted');
    expect(html).not.toContain('v4.buildwithoracle.com wants to');
    expect(html).not.toContain('The real Chrome prompt appears here.');
  });

  test('browser health check uses no-cors to identify CORS-only failures', async () => {
    const calls: Array<{ url: string | URL | Request; init?: RequestInit }> = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url, init });
      return calls.length === 1
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(new Response('', { status: 204 }));
    }) as typeof fetch;

    try {
      await browserHealthCheck();
      throw new Error('expected browserHealthCheck to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(BrowserHealthError);
      expect((error as BrowserHealthError).issue).toBe('cors');
      expect((error as Error).message).toContain('ARRA_CORS_ORIGINS');
    } finally {
      globalThis.fetch = previousFetch;
    }

    expect(calls).toHaveLength(2);
    expect(String(calls[0]?.url)).toBe('http://localhost:47778/api/health');
    expect(calls[1]?.init?.mode).toBe('no-cors');
  });

  test('browser health check preserves PNA/connectivity failures when no-cors also rejects', async () => {
    const calls: Array<RequestInit | undefined> = [];
    const original = new TypeError('Failed to fetch');
    const previousFetch = globalThis.fetch;
    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init);
      return Promise.reject(calls.length === 1 ? original : new TypeError('Private network blocked'));
    }) as typeof fetch;

    try {
      await browserHealthCheck();
      throw new Error('expected browserHealthCheck to reject');
    } catch (error) {
      expect(error).toBe(original);
    } finally {
      globalThis.fetch = previousFetch;
    }

    expect(calls).toHaveLength(2);
    expect(calls[1]?.mode).toBe('no-cors');
  });

  test('CORS-rejected health checks render origin-trust guidance, not the PNA prompt', async () => {
    const restoreLocation = installBrowserLocation('https://studio.example/memory');
    const previousFetch = globalThis.fetch;
    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => init?.mode === 'no-cors'
      ? Promise.resolve(new Response('', { status: 204 }))
      : Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;

    try {
      await browserHealthCheck();
      throw new Error('expected browserHealthCheck to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(BrowserHealthError);
      const html = htmlFor(
        <ConnectOracleSetup
          accessIssue={(error as BrowserHealthError).issue}
          isTauri={false}
          message={(error as Error).message}
          onRetry={() => {}}
          onStartBackend={() => {}}
          starting={false}
          state="unreachable"
        />,
      );

      expect(html).toContain('https://studio.example is not in the backend CORS allowlist');
      expect(html).toContain('The backend answered, but this Studio origin is not trusted.');
      expect(html).toContain('ARRA_CORS_ORIGINS');
      expect(html).not.toContain('v4.buildwithoracle.com wants to');
      expect(html).not.toContain('The real Chrome prompt appears here.');
    } finally {
      globalThis.fetch = previousFetch;
      restoreLocation();
    }
  });

  test('genuine connectivity failures still render the PNA guide', async () => {
    const previousFetch = globalThis.fetch;
    const original = new TypeError('Failed to fetch');
    globalThis.fetch = (() => Promise.reject(original)) as typeof fetch;

    try {
      await browserHealthCheck();
      throw new Error('expected browserHealthCheck to reject');
    } catch (error) {
      expect(error).toBe(original);
      const html = htmlFor(
        <ConnectOracleSetup
          accessIssue="pna"
          isTauri={false}
          message={(error as Error).message}
          onRetry={() => {}}
          onStartBackend={() => {}}
          starting={false}
          state="unreachable"
        />,
      );

      expect(html).toContain('Cannot reach http://localhost:47778: Failed to fetch');
      expect(html).toContain('v4.buildwithoracle.com wants to');
      expect(html).toContain('The real Chrome prompt appears here.');
      expect(html).not.toContain('ARRA_CORS_ORIGINS');
      expect(html).not.toContain('this Studio origin is not trusted');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
