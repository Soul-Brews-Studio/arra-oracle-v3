import { afterEach, describe, expect, it } from 'bun:test';

import {
  createScoutAnnouncerConfig,
  DEFAULT_SCOUT_INTERVAL_MS,
  makeScoutHello,
} from '../../peer/scout-announcer.ts';
import { PORT } from '../../config.ts';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('Scout announcer', () => {
  it('builds maw-compatible hello packets with arra-search capability', () => {
    const hello = makeScoutHello({
      zid: '0123456789abcdef0123456789abcdef',
      node: 'arra@m5',
      locator: 'http://m5.local:47778',
      capabilities: ['pair', 'feed', 'send', 'arra-search'],
      oracles: ['arra'],
    }, 1_700_000_000_000);

    expect(hello).toEqual({
      type: 'maw-hello',
      version: 1,
      zid: '0123456789abcdef0123456789abcdef',
      whatAmI: 'oracle',
      node: 'arra@m5',
      oracle: 'arra',
      locators: ['http://m5.local:47778'],
      capabilities: ['pair', 'feed', 'send', 'arra-search'],
      oracles: ['arra'],
      ts: 1_700_000_000_000,
    });
  });

  it('uses ORACLE_SCOUT_URL for the advertised locator without changing node identity', () => {
    process.env.ORACLE_HOST = 'm5';
    process.env.ORACLE_NODE = 'arra@m5';
    process.env.ORACLE_SCOUT_URL = 'http://m5.local:47778/';
    process.env.ORACLE_SCOUT_INTERVAL_MS = '1234';

    const config = createScoutAnnouncerConfig(process.env);

    expect(config.node).toBe('arra@m5');
    expect(config.locator).toBe('http://m5.local:47778');
    expect(config.intervalMs).toBe(1234);
    expect(config.zid).toMatch(/^[0-9a-f]{32}$/);
    expect(config.capabilities).toContain('pair');
    expect(config.capabilities).toContain('arra-search');
    expect(config.oracles).toEqual(['arra']);
  });

  it('defaults the locator to <host>.local and honors MAW_ANNOUNCE_HOST', () => {
    process.env.ORACLE_HOST = 'm5';

    const defaultConfig = createScoutAnnouncerConfig(process.env);
    expect(defaultConfig.node).toBe('arra@m5');
    expect(defaultConfig.locator).toBe(`http://m5.local:${PORT}`);

    process.env.MAW_ANNOUNCE_HOST = 'arra.lan';
    const overrideConfig = createScoutAnnouncerConfig(process.env);
    expect(overrideConfig.locator).toBe(`http://arra.lan:${PORT}`);
  });

  it('defaults to maw-compatible 30s reannounce cadence', () => {
    const config = createScoutAnnouncerConfig(process.env);

    expect(config.intervalMs).toBe(DEFAULT_SCOUT_INTERVAL_MS);
  });
});
