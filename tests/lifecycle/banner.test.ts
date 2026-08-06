import { describe, expect, test } from 'bun:test';
import { formatStartupBanner, printStartupBanner } from '../../src/lifecycle/banner.ts';

describe('startup banner', () => {
  test('formats version and port in the server banner', () => {
    const banner = formatStartupBanner({
      version: '26.5.30-alpha.2229',
      port: 47778,
      profile: 'production',
      middleware: ['cors', { name: 'rate-limit', detail: '60/min' }],
      dbStatus: 'ok',
    });

    expect(banner).toContain('26.5.30-alpha.2229');
    expect(banner).toContain('47778');
    expect(banner).toContain('Profile:    production');
    expect(banner).toContain('Database:   ok');
  });

  test('prints the formatted banner through console.log by default', () => {
    const calls: string[] = [];
    const original = console.log;
    console.log = (message?: unknown) => { calls.push(String(message)); };
    try {
      printStartupBanner({
        version: '26.6.1-alpha.1',
        port: 48888,
        profile: 'development',
        middleware: [],
        dbStatus: 'ok',
      });
    } finally {
      console.log = original;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('26.6.1-alpha.1');
    expect(calls[0]).toContain('48888');
  });
});
