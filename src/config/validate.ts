import { Value } from '@sinclair/typebox/value';
import {
  BOOLEAN_ENV_KEYS,
  EMBEDDER_VALUES,
  EnvSchema,
  INTEGER_ENV_KEYS,
  OPTIONAL_DEFAULTS,
  PORT_ENV_KEYS,
  URL_ENV_KEYS,
  VECTOR_DB_VALUES,
  VECTOR_FALLBACK_VALUES,
  type RuntimeEnv,
} from './schema.ts';

export class ConfigValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Config validation failed:\n${issues.map((issue) => ` - ${issue}`).join('\n')}`);
    this.name = 'ConfigValidationError';
  }
}

interface ValidateEnvOptions {
  env?: NodeJS.ProcessEnv;
  warn?: (message: string) => void;
  emitOptionalWarnings?: boolean;
}

export interface ConfigValidationResult {
  env: RuntimeEnv;
  warnings: string[];
}

const BOOL_VALUES = new Set(['0', '1', 'true', 'false', 'yes', 'no', 'on', 'off']);
const SQLITE_PROTOCOLS = ['file:', 'sqlite:', 'sqlite3:'];

export function validateEnv(options: ValidateEnvOptions = {}): ConfigValidationResult {
  const env = cleanEnv(options.env ?? process.env);
  const issues = schemaIssues(env);

  requireHome(env, issues);
  validateIntegers(env, issues);
  validateBooleans(env, issues);
  validateUrls(env, issues);
  validateEnums(env, issues);
  validateDatabaseUrl(env, issues);
  validateProviderRequirements(env, issues);

  if (issues.length) throw new ConfigValidationError(issues);

  const warnings = optionalWarnings(env);
  if (options.emitOptionalWarnings !== false) {
    for (const warning of warnings) (options.warn ?? console.warn)(`[Config] ${warning}`);
  }
  return { env, warnings };
}

export function validateStartupEnv(): ConfigValidationResult {
  return validateEnv();
}

function cleanEnv(env: NodeJS.ProcessEnv): RuntimeEnv {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = String(value);
  }
  return out as RuntimeEnv;
}

function schemaIssues(env: RuntimeEnv): string[] {
  if (Value.Check(EnvSchema, env)) return [];
  return [...Value.Errors(EnvSchema, env)].map((error) => {
    const path = error.path.replace(/^\//, '') || 'env';
    return `${path}: ${error.message}`;
  });
}

function requireHome(env: RuntimeEnv, issues: string[]): void {
  if (!filled(env.HOME) && !filled(env.USERPROFILE)) {
    issues.push('HOME or USERPROFILE is required to resolve data, DB, and plugin paths.');
  }
}

function validateIntegers(env: RuntimeEnv, issues: string[]): void {
  for (const key of INTEGER_ENV_KEYS) {
    const value = env[key];
    if (!filled(value)) continue;
    if (!/^\d+$/.test(value)) {
      issues.push(`${key} must be a positive integer; received "${value}".`);
      continue;
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      issues.push(`${key} must be greater than 0; received "${value}".`);
    }
  }
  for (const key of PORT_ENV_KEYS) {
    const value = env[key];
    if (filled(value) && Number(value) > 65_535) issues.push(`${key} must be <= 65535; received "${value}".`);
  }
}

function validateBooleans(env: RuntimeEnv, issues: string[]): void {
  for (const key of BOOLEAN_ENV_KEYS) {
    const value = env[key];
    if (filled(value) && !BOOL_VALUES.has(value.toLowerCase())) {
      issues.push(`${key} must be boolean-like (0/1/true/false/yes/no/on/off); received "${value}".`);
    }
  }
}

function validateUrls(env: RuntimeEnv, issues: string[]): void {
  for (const key of URL_ENV_KEYS) {
    const value = env[key];
    if (!filled(value)) continue;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) issues.push(`${key} must be http(s); received "${value}".`);
    } catch {
      issues.push(`${key} must be a valid URL; received "${value}".`);
    }
  }
  if (filled(env.ORACLE_HTTP_URL) && env.ORACLE_HTTP_URL !== 'embedded') {
    try { new URL(env.ORACLE_HTTP_URL); } catch { issues.push('ORACLE_HTTP_URL must be a valid URL or "embedded".'); }
  }
}

function validateEnums(env: RuntimeEnv, issues: string[]): void {
  checkEnum(env, issues, ['ORACLE_EMBEDDER', 'ORACLE_EMBEDDER_BACKEND', 'ORACLE_EMBEDDING_PROVIDER', 'EMBEDDER_TYPE'], EMBEDDER_VALUES);
  checkEnum(env, issues, ['ORACLE_VECTOR_DB'], VECTOR_DB_VALUES);
  checkEnum(env, issues, ['VECTOR_FALLBACK'], VECTOR_FALLBACK_VALUES);
}

function validateDatabaseUrl(env: RuntimeEnv, issues: string[]): void {
  const value = env.DATABASE_URL;
  if (!filled(value)) return;
  try {
    const url = new URL(value);
    if (!SQLITE_PROTOCOLS.includes(url.protocol)) {
      issues.push('DATABASE_URL must use sqlite:, sqlite3:, or file: for this SQLite runtime.');
    }
  } catch {
    if (!value.startsWith('/') && !value.startsWith('./') && !value.startsWith('../')) {
      issues.push('DATABASE_URL must be a sqlite/file URL or filesystem path.');
    }
  }
}

function validateProviderRequirements(env: RuntimeEnv, issues: string[]): void {
  const embedder = normalizeEmbedder(env.ORACLE_EMBEDDER ?? env.ORACLE_EMBEDDER_BACKEND ?? env.ORACLE_EMBEDDING_PROVIDER ?? env.EMBEDDER_TYPE);
  if (embedder === 'remote' && !filled(env.ORACLE_EMBEDDER_URL) && !filled(env.ORACLE_REMOTE_EMBEDDING_URL)) {
    issues.push('Remote embedder requires ORACLE_EMBEDDER_URL or ORACLE_REMOTE_EMBEDDING_URL.');
  }
  if (embedder === 'openai' && !filled(env.OPENAI_API_KEY)) issues.push('OpenAI embedder requires OPENAI_API_KEY.');
  const cloudflare = embedder === 'cloudflare-ai' || env.ORACLE_VECTOR_DB === 'cloudflare-vectorize';
  if (cloudflare && (!filled(env.CLOUDFLARE_ACCOUNT_ID) || !filled(env.CLOUDFLARE_API_TOKEN))) {
    issues.push('Cloudflare vector/AI config requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.');
  }
}

function optionalWarnings(env: RuntimeEnv): string[] {
  return OPTIONAL_DEFAULTS
    .filter((item) => !item.keys.some((key) => filled(env[key])))
    .map((item) => `${item.label} is unset; using ${item.fallback}.`);
}

function checkEnum<T extends readonly string[]>(env: RuntimeEnv, issues: string[], keys: readonly string[], allowed: T): void {
  for (const key of keys) {
    const value = env[key];
    if (filled(value) && !(allowed as readonly string[]).includes(value.toLowerCase())) {
      issues.push(`${key} must be one of ${allowed.join(', ')}; received "${value}".`);
    }
  }
}

function normalizeEmbedder(value?: string): string {
  const normalized = value?.trim().toLowerCase() || 'none';
  if (['disabled', 'off', 'zero'].includes(normalized)) return 'none';
  if (['http', 'external'].includes(normalized)) return 'remote';
  if (normalized === 'ollama-local') return 'local';
  return normalized;
}

function filled(value?: string): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
