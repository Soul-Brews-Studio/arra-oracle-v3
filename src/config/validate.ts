import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Value } from '@sinclair/typebox/value';
import {
  ARRA_ENV_VALUES,
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
import { applyProfileDefaults, resolveConfigProfile, type ConfigProfile } from './profiles.ts';

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
  profile: ConfigProfile;
  warnings: string[];
}

const BOOL_VALUES = new Set(['0', '1', 'true', 'false', 'yes', 'no', 'on', 'off']);
const SQLITE_PROTOCOLS = ['file:', 'sqlite:', 'sqlite3:'];

export function validateEnv(options: ValidateEnvOptions = {}): ConfigValidationResult {
  const env = applyProfileDefaults(cleanEnv(options.env ?? process.env));
  const issues = schemaIssues(env);

  requireHome(env, issues);
  validateIntegers(env, issues);
  validateBooleans(env, issues);
  validateUrls(env, issues);
  validateEnums(env, issues);
  validateDatabaseUrl(env, issues);
  validateRuntimePaths(env, issues);
  validateVectorConnectionConfig(env, issues);
  validateProviderRequirements(env, issues);

  if (issues.length) throw new ConfigValidationError(issues);

  const warnings = optionalWarnings(env);
  if (options.emitOptionalWarnings !== false) {
    for (const warning of warnings) (options.warn ?? console.warn)(`[Config] ${warning}`);
  }
  return { env, profile: resolveConfigProfile(env), warnings };
}

export function validateStartupEnv(): ConfigValidationResult { return validateEnv(); }

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
    const allowsEphemeralPort = (PORT_ENV_KEYS as readonly string[]).includes(key) && parsed === 0;
    if (!Number.isSafeInteger(parsed) || (parsed <= 0 && !allowsEphemeralPort)) {
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
  checkEnum(env, issues, ['ARRA_ENV'], ARRA_ENV_VALUES);
  checkEnum(env, issues, ['ORACLE_EMBEDDER', 'ORACLE_EMBEDDER_BACKEND', 'ORACLE_EMBEDDING_PROVIDER', 'EMBEDDER_TYPE'], EMBEDDER_VALUES);
  checkEnum(env, issues, ['ORACLE_VECTOR_DB'], VECTOR_DB_VALUES);
  checkEnum(env, issues, ['VECTOR_FALLBACK'], VECTOR_FALLBACK_VALUES);
  checkEnum(env, issues, ['LOG_FORMAT'], ['nginx', 'json', 'short'] as const);
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
  if (embedder === 'gemini' && !filled(env.GEMINI_API_KEY)) issues.push('Gemini embedder requires GEMINI_API_KEY.');
  const cloudflare = embedder === 'cloudflare-ai' || env.ORACLE_VECTOR_DB === 'cloudflare-vectorize';
  if (cloudflare && ((!filled(env.CLOUDFLARE_ACCOUNT_ID) && !filled(env.CF_ACCOUNT_ID)) || (!filled(env.CLOUDFLARE_API_TOKEN) && !filled(env.CF_API_TOKEN)))) {
    issues.push('Cloudflare vector/AI config requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.');
  }
}

function validateRuntimePaths(env: RuntimeEnv, issues: string[]): void {
  const dataDir = env.ORACLE_DATA_DIR || resolve(homeDir(env) || '.', '.arra-oracle-v2');
  const dbPath = env.ORACLE_DB_PATH || pathFromDatabaseUrl(env.DATABASE_URL) || resolve(dataDir, 'oracle.db');
  validateWritablePath('ORACLE_DATA_DIR', dataDir, issues, true);
  validateWritablePath('ORACLE_DB_PATH/DATABASE_URL', dbPath, issues, false);
  if (filled(env.ORACLE_REPO_ROOT)) validateWritablePath('ORACLE_REPO_ROOT', env.ORACLE_REPO_ROOT, issues, true);
}

function validateVectorConnectionConfig(env: RuntimeEnv, issues: string[]): void {
  const type = (env.ORACLE_VECTOR_DB || 'lancedb').toLowerCase();
  if (type === 'qdrant' && !filled(env.QDRANT_URL)) issues.push('Qdrant vector DB requires QDRANT_URL.');
  if (type === 'proxy' && !filled(env.ORACLE_PROXY_VECTOR_URL)) issues.push('Proxy vector DB requires ORACLE_PROXY_VECTOR_URL.');
  if (type === 'lancedb' || type === 'sqlite-vec') {
    const base = env.ORACLE_VECTOR_DB_PATH || resolve(env.ORACLE_DATA_DIR || resolve(homeDir(env) || '.', '.arra-oracle-v2'), type === 'lancedb' ? 'lancedb' : 'vectors.db');
    validateWritablePath('ORACLE_VECTOR_DB_PATH', base, issues, type === 'lancedb');
  }
}

function validateWritablePath(label: string, target: string, issues: string[], directory: boolean): void {
  if (!filled(target)) return;
  try {
    if (existsSync(target)) {
      const stat = statSync(target);
      if (directory && !stat.isDirectory()) issues.push(`${label} must be a directory; received file path "${target}".`);
      if (!directory && stat.isDirectory()) issues.push(`${label} must be a file path; received directory "${target}".`);
      accessSync(directory ? target : dirname(target), constants.W_OK);
      return;
    }
    accessSync(nearestExistingDir(directory ? target : dirname(target)), constants.W_OK);
  } catch (error) {
    issues.push(`${label} must be writable and resolvable; received "${target}" (${error instanceof Error ? error.message : String(error)}).`);
  }
}

function nearestExistingDir(start: string): string {
  let dir = resolve(start);
  while (!existsSync(dir)) {
    const next = dirname(dir);
    if (next === dir) break;
    dir = next;
  }
  return dir;
}

function pathFromDatabaseUrl(value?: string): string {
  if (!filled(value)) return '';
  try {
    const url = new URL(value);
    if (url.protocol === 'file:') return fileURLToPath(url);
    if (url.protocol === 'sqlite:' || url.protocol === 'sqlite3:') return decodeURIComponent(url.pathname || url.host);
  } catch { return value; }
  return value;
}

const homeDir = (env: RuntimeEnv): string => env.HOME || env.USERPROFILE || '';
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
