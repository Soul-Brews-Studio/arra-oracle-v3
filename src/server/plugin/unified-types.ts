import { homedir } from 'node:os';
import { join } from 'node:path';

import type {
  ServerPluginApiManifest,
  ServerPluginLifecycleContext,
  ServerPluginTier,
} from './types.ts';

export const USER_PLUGIN_DIR = join(homedir(), '.arra', 'plugins');
export const BUNDLED_PLUGIN_DIR = join(import.meta.dir, '../../../cli/src/plugins');
export const TIMEOUT_MS = Number(process.env.ARRA_PLUGIN_TIMEOUT_MS ?? 5000);

const TIERS = new Set(['core', 'standard', 'extra']);
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'ALL']);

export interface UnifiedManifestLifecycle {
  start?: boolean;
  stop?: boolean;
}

export interface UnifiedManifest {
  name: string;
  version: string;
  entry: string;
  sdk: string;
  tier?: ServerPluginTier;
  enabled?: boolean;
  seedMenu?: boolean;
  api?: ServerPluginApiManifest;
  lifecycle?: UnifiedManifestLifecycle;
}

export interface LoadedUnifiedManifestPlugin {
  manifest: UnifiedManifest;
  dir: string;
  entryPath: string;
}

export interface UnifiedManifestPluginOptions {
  bundledDir?: string;
  userDir?: string;
}

export type UnifiedInvokeContext = {
  source: 'api' | 'lifecycle';
  args: string[];
  request?: Request;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  lifecycle?: 'start' | 'stop';
  server?: ServerPluginLifecycleContext;
};

export type UnifiedInvokeResult = {
  ok: boolean;
  output?: string;
  body?: unknown;
  status?: number;
  headers?: Record<string, string>;
  error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseManifest(raw: unknown): UnifiedManifest {
  if (!isRecord(raw)) throw new Error('manifest must be a JSON object');
  return raw as unknown as UnifiedManifest;
}

export function validateUnifiedManifest(m: UnifiedManifest): void {
  if (!m.name || !/^[a-z0-9-]+$/.test(m.name)) {
    throw new Error(`manifest.name must match /^[a-z0-9-]+$/, got: ${JSON.stringify(m.name)}`);
  }
  if (!m.version || !/^\d+\.\d+\.\d+/.test(m.version)) {
    throw new Error(`manifest.version must be semver, got: ${JSON.stringify(m.version)}`);
  }
  if (!m.entry || typeof m.entry !== 'string') throw new Error('manifest.entry must be a string path');
  if (!m.sdk || typeof m.sdk !== 'string') throw new Error('manifest.sdk must be a semver range string');
  if (m.tier !== undefined && !TIERS.has(m.tier)) {
    throw new Error(`manifest.tier must be core, standard, or extra; got: ${JSON.stringify(m.tier)}`);
  }
  if (m.enabled !== undefined && typeof m.enabled !== 'boolean') throw new Error('manifest.enabled must be a boolean');
  if (m.seedMenu !== undefined && typeof m.seedMenu !== 'boolean') throw new Error('manifest.seedMenu must be a boolean');
  if (m.api) validateApi(m.api);
  if (m.lifecycle) validateLifecycle(m.lifecycle);
}

function validateApi(api: ServerPluginApiManifest): void {
  if (!api.path || typeof api.path !== 'string' || !api.path.startsWith('/')) {
    throw new Error('manifest.api.path must be an absolute path');
  }
  for (const method of api.methods ?? []) {
    if (typeof method !== 'string' || !HTTP_METHODS.has(method.toUpperCase())) {
      throw new Error(`manifest.api.methods contains invalid method: ${JSON.stringify(method)}`);
    }
  }
}

function validateLifecycle(lifecycle: UnifiedManifestLifecycle): void {
  if (lifecycle.start !== undefined && typeof lifecycle.start !== 'boolean') {
    throw new Error('manifest.lifecycle.start must be a boolean');
  }
  if (lifecycle.stop !== undefined && typeof lifecycle.stop !== 'boolean') {
    throw new Error('manifest.lifecycle.stop must be a boolean');
  }
}
