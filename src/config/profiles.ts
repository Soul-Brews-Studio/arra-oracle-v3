import { ARRA_ENV_VALUES, type RuntimeEnv } from './schema.ts';

export type ArraEnv = typeof ARRA_ENV_VALUES[number];

export interface RateLimitProfile {
  enabled: boolean;
  tokensPerWindow: number;
  windowMs: number;
  burst: number;
}

export interface ConfigProfile {
  env: ArraEnv;
  verboseLogging: boolean;
  rateLimit: RateLimitProfile;
  envDefaults: Record<string, string>;
}

const PROFILE_DEFAULTS: Record<ArraEnv, { envDefaults: Record<string, string> }> = {
  development: {
    envDefaults: {
      DEBUG: '1',
      ARRA_VERBOSE_LOGGING: '1',
      ARRA_RATE_LIMIT_ENABLED: '0',
      ARRA_RATE_LIMIT_TOKENS_PER_WINDOW: '600',
      ARRA_RATE_LIMIT_WINDOW_MS: '60000',
      ARRA_RATE_LIMIT_BURST: '600',
      ORACLE_GATEWAY_HOT_RELOAD: '1',
      ORACLE_TOOL_GROUPS_HOT_RELOAD: '1',
    },
  },
  staging: {
    envDefaults: {
      DEBUG: '0',
      ARRA_VERBOSE_LOGGING: '0',
      ARRA_RATE_LIMIT_ENABLED: '1',
      ARRA_RATE_LIMIT_TOKENS_PER_WINDOW: '120',
      ARRA_RATE_LIMIT_WINDOW_MS: '60000',
      ARRA_RATE_LIMIT_BURST: '180',
      ORACLE_GATEWAY_HOT_RELOAD: '1',
      ORACLE_TOOL_GROUPS_HOT_RELOAD: '1',
    },
  },
  production: {
    envDefaults: {
      DEBUG: '0',
      ARRA_VERBOSE_LOGGING: '0',
      ARRA_RATE_LIMIT_ENABLED: '1',
      ARRA_RATE_LIMIT_TOKENS_PER_WINDOW: '60',
      ARRA_RATE_LIMIT_WINDOW_MS: '60000',
      ARRA_RATE_LIMIT_BURST: '60',
      ORACLE_GATEWAY_HOT_RELOAD: '0',
      ORACLE_TOOL_GROUPS_HOT_RELOAD: '0',
    },
  },
};

export function isArraEnv(value: string): value is ArraEnv {
  return (ARRA_ENV_VALUES as readonly string[]).includes(value);
}

export function resolveArraEnv(env: NodeJS.ProcessEnv = process.env): ArraEnv {
  const value = env.ARRA_ENV?.trim().toLowerCase();
  return value && isArraEnv(value) ? value : 'development';
}

export function profileDefaultsFor(envName: ArraEnv): Record<string, string> {
  return { ...PROFILE_DEFAULTS[envName].envDefaults };
}

export function applyProfileDefaults(env: NodeJS.ProcessEnv = process.env): RuntimeEnv {
  const profileName = resolveArraEnv(env);
  const merged: Record<string, string> = profileDefaultsFor(profileName);
  for (const [key, value] of Object.entries(env)) {
    if (filled(value)) merged[key] = String(value);
  }
  if (!filled(merged.ARRA_ENV)) merged.ARRA_ENV = profileName;
  return merged as RuntimeEnv;
}

export function applyProfileDefaultsToProcessEnv(env: NodeJS.ProcessEnv = process.env): RuntimeEnv {
  const profileName = resolveArraEnv(env);
  for (const [key, value] of Object.entries(PROFILE_DEFAULTS[profileName].envDefaults)) {
    if (!filled(env[key])) env[key] = value;
  }
  if (!filled(env.ARRA_ENV)) env.ARRA_ENV = profileName;
  return applyProfileDefaults(env);
}

export function resolveConfigProfile(env: NodeJS.ProcessEnv = process.env): ConfigProfile {
  const merged = applyProfileDefaults(env);
  const envName = resolveArraEnv(merged);
  return {
    env: envName,
    verboseLogging: boolFrom(merged.ARRA_VERBOSE_LOGGING ?? merged.DEBUG, envName === 'development'),
    rateLimit: {
      enabled: boolFrom(merged.ARRA_RATE_LIMIT_ENABLED, envName !== 'development'),
      tokensPerWindow: intFrom(merged.ARRA_RATE_LIMIT_TOKENS_PER_WINDOW, envName === 'production' ? 60 : 120),
      windowMs: intFrom(merged.ARRA_RATE_LIMIT_WINDOW_MS, 60_000),
      burst: intFrom(merged.ARRA_RATE_LIMIT_BURST, envName === 'staging' ? 180 : 60),
    },
    envDefaults: profileDefaultsFor(envName),
  };
}

function boolFrom(value: string | undefined, fallback: boolean): boolean {
  if (!filled(value)) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function intFrom(value: string | undefined, fallback: number): number {
  if (!filled(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function filled(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
