import { existsSync } from 'node:fs';
import { configPath, generateDefaultConfig, loadVectorConfig, type VectorServerConfig } from '../vector/config.ts';

export type SelfTestStatus = 'pass' | 'fail';
export type MaybePromise<T> = T | Promise<T>;

export interface StartupSelfTestCheck {
  name: string;
  run: () => MaybePromise<void>;
}

export interface StartupSelfTestResult {
  name: string;
  status: SelfTestStatus;
  message: string;
}

export interface StartupSelfTestOptions {
  checks: readonly StartupSelfTestCheck[];
  log?: (message: string) => void;
}

export interface StartupSelfTestDependencies {
  dbPing: () => MaybePromise<string | void>;
  healthFetch: () => MaybePromise<Response>;
  vectorConfig?: () => unknown;
}

export function createStartupSelfTest(deps: StartupSelfTestDependencies): StartupSelfTestCheck[] {
  return [
    { name: 'db', run: () => assertDbPing(deps.dbPing) },
    { name: 'health-endpoint', run: () => assertHealthEndpoint(deps.healthFetch) },
    { name: 'vector-config', run: () => validateVectorConfig(readVectorConfig(deps.vectorConfig)) },
  ];
}

export async function runStartupSelfTest(options: StartupSelfTestOptions): Promise<StartupSelfTestResult[]> {
  const log = options.log ?? console.log;
  const results: StartupSelfTestResult[] = [];
  for (const check of options.checks) {
    try {
      await check.run();
      results.push({ name: check.name, status: 'pass', message: 'ok' });
      log(`[SelfTest] PASS ${check.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ name: check.name, status: 'fail', message });
      log(`[SelfTest] FAIL ${check.name} — ${message}`);
    }
  }
  const passed = results.filter((result) => result.status === 'pass').length;
  log(`[SelfTest] summary: ${passed} passed, ${results.length - passed} failed`);
  return results;
}

export function validateVectorConfig(config: unknown): asserts config is VectorServerConfig {
  if (!isRecord(config)) throw new Error('vector config must be an object');
  if (!filled(config.version)) throw new Error('vector config version is required');
  if (!filled(config.host)) throw new Error('vector config host is required');
  if (!validPort(config.port)) throw new Error('vector config port must be 1-65535');
  if (!filled(config.dataPath)) throw new Error('vector config dataPath is required');
  if (!isRecord(config.collections) || Object.keys(config.collections).length === 0) {
    throw new Error('vector config collections must not be empty');
  }
  for (const [name, collection] of Object.entries(config.collections)) {
    validateVectorCollection(name, collection);
  }
}

async function assertDbPing(dbPing: StartupSelfTestDependencies['dbPing']): Promise<void> {
  const status = await dbPing();
  if (typeof status === 'string' && status !== 'ok') throw new Error(status);
}

async function assertHealthEndpoint(healthFetch: StartupSelfTestDependencies['healthFetch']): Promise<void> {
  const response = await healthFetch();
  if (!response.ok) throw new Error(`/api/health responded ${response.status}`);
}

function readVectorConfig(loader?: () => unknown): unknown {
  if (loader) return loader();
  const path = configPath();
  const loaded = loadVectorConfig(path);
  if (loaded) return loaded;
  if (existsSync(path)) throw new Error(`vector config ${path} could not be parsed`);
  return generateDefaultConfig();
}

function validateVectorCollection(name: string, collection: unknown): void {
  if (!isRecord(collection)) throw new Error(`vector collection ${name} must be an object`);
  if (!filled(collection.collection)) throw new Error(`vector collection ${name} collection is required`);
  if (!filled(collection.model)) throw new Error(`vector collection ${name} model is required`);
  if (!filled(collection.provider)) throw new Error(`vector collection ${name} provider is required`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function filled(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65_535;
}
