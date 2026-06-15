import { describe, expect, test } from 'bun:test';
import {
  applyProfileDefaults,
  resolveArraEnv,
  resolveConfigProfile,
} from '../../src/config/profiles.ts';
import { validateEnv } from '../../src/config/validate.ts';

describe('environment config profiles', () => {
  test('defaults to development with verbose logging and no rate limit', () => {
    const env = applyProfileDefaults({ HOME: '/tmp/arra-home' });
    const profile = resolveConfigProfile(env);

    expect(resolveArraEnv(env)).toBe('development');
    expect(env.DEBUG).toBe('1');
    expect(profile.verboseLogging).toBe(true);
    expect(profile.rateLimit.enabled).toBe(false);
  });

  test('production enables conservative rate limiting defaults', () => {
    const result = validateEnv({ env: { HOME: '/tmp/arra-home', ARRA_ENV: 'production' }, emitOptionalWarnings: false });

    expect(result.profile.env).toBe('production');
    expect(result.profile.verboseLogging).toBe(false);
    expect(result.profile.rateLimit).toEqual({ enabled: true, tokensPerWindow: 60, windowMs: 60000, burst: 60 });
    expect(result.env.ORACLE_GATEWAY_HOT_RELOAD).toBe('0');
  });

  test('explicit environment overrides profile defaults', () => {
    const profile = resolveConfigProfile({
      HOME: '/tmp/arra-home',
      ARRA_ENV: 'production',
      ARRA_RATE_LIMIT_TOKENS_PER_WINDOW: '250',
      ARRA_RATE_LIMIT_BURST: '300',
      ARRA_VERBOSE_LOGGING: '1',
    });

    expect(profile.verboseLogging).toBe(true);
    expect(profile.rateLimit.tokensPerWindow).toBe(250);
    expect(profile.rateLimit.burst).toBe(300);
  });

  test('validation rejects unknown ARRA_ENV values clearly', () => {
    expect(() => validateEnv({ env: { HOME: '/tmp/arra-home', ARRA_ENV: 'qa' }, emitOptionalWarnings: false }))
      .toThrow(/ARRA_ENV must be one of development, staging, production/);
  });
});
