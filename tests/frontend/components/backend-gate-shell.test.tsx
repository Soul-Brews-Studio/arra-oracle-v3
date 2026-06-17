import { describe, expect, test } from 'bun:test';
import {
  BackendGate,
  ConnectOracleSetup,
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
});
