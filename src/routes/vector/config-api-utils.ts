import fs from 'fs';
import path from 'path';
import {
  configPath,
  configToModels,
  generateDefaultConfig,
  loadVectorConfig,
  writeVectorConfig,
  type VectorCollectionConfig,
  type VectorServerConfig,
} from '../../vector/config.ts';
import { createVectorStoreForModel } from '../../vector/factory.ts';
import type { VectorDBType } from '../../vector/types.ts';

export type CollectionUpdate = Partial<Pick<VectorCollectionConfig,
  'adapter' | 'model' | 'provider' | 'service' | 'endpoint' | 'enabled' | 'primary' | 'embedder'
>>;
export type CollectionCreate = CollectionUpdate & { collection?: string };

export type CollectionHealth = {
  key: string;
  collection: string;
  model: string;
  provider: string;
  adapter: VectorDBType;
  service?: string;
  endpoint?: string;
  enabled: boolean;
  count: number;
  ok: boolean;
  status: 'ok' | 'down' | 'disabled';
  error?: string;
};

export function activeConfig(): { source: 'file' | 'defaults'; config: VectorServerConfig } {
  const fromDisk = loadVectorConfig(currentConfigPath());
  return { source: fromDisk ? 'file' : 'defaults', config: fromDisk ?? generateDefaultConfig() };
}

function currentConfigPath(): string {
  return process.env.ORACLE_DATA_DIR ? configPath(process.env.ORACLE_DATA_DIR) : configPath();
}

export function resolveCollection(
  config: VectorServerConfig,
  collection: string,
): [string, VectorCollectionConfig] | null {
  const direct = config.collections[collection];
  if (direct) return [collection, direct];
  return Object.entries(config.collections).find(([, value]) => value.collection === collection) ?? null;
}

export function atomicWriteVectorConfig(config: VectorServerConfig): string {
  const target = currentConfigPath();
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    writeVectorConfig(config, tmp);
    fs.renameSync(tmp, target);
    return target;
  } catch (e) { try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {} throw e; }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

export async function inspectCollection(
  key: string,
  col: VectorCollectionConfig,
  config: VectorServerConfig,
): Promise<CollectionHealth> {
  const adapter = col.adapter || 'lancedb';
  if (col.enabled === false) {
    return {
      key, collection: col.collection, model: col.model, provider: col.provider,
      adapter, service: col.service, endpoint: col.endpoint,
      enabled: false, count: 0, ok: false, status: 'disabled',
    };
  }
  const timeout = parseInt(process.env.ORACLE_VECTOR_HEALTH_TIMEOUT || '2000', 10);
  const preset = configToModels(config)[key];
  if (!preset) throw new Error(`Collection ${key} is not enabled`);
  const store = createVectorStoreForModel(preset);
  try {
    await withTimeout(store.connect(), timeout);
    const stats = await withTimeout(store.getStats(), timeout);
    return {
      key, collection: col.collection, model: col.model, provider: col.provider,
      adapter, service: col.service, endpoint: col.endpoint,
      enabled: true, count: stats.count, ok: true, status: 'ok',
    };
  } catch (e) {
    return {
      key, collection: col.collection, model: col.model, provider: col.provider,
      adapter, service: col.service, endpoint: col.endpoint,
      enabled: true, count: 0, ok: false, status: 'down',
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    await store.close().catch(() => undefined);
  }
}

export function normalizedUpdate(body: CollectionUpdate): CollectionUpdate | { error: string } {
  const update: CollectionUpdate = {};
  if (body.adapter !== undefined) update.adapter = body.adapter;
  if (body.model !== undefined) {
    const model = body.model.trim();
    if (!model) return { error: 'model must be a non-empty string' };
    update.model = model;
  }
  if (body.provider !== undefined) {
    const provider = body.provider.trim();
    if (!provider) return { error: 'provider must be a non-empty string' };
    update.provider = provider;
  }
  if (body.service !== undefined) update.service = body.service;
  if (body.endpoint !== undefined) update.endpoint = body.endpoint;
  if (body.enabled !== undefined) update.enabled = body.enabled;
  if (body.primary !== undefined) update.primary = body.primary;
  if (body.embedder !== undefined) update.embedder = body.embedder;
  if (!Object.keys(update).length) return { error: 'body must include adapter, model, provider, service, endpoint, enabled, primary, or embedder' };
  return update;
}

export function normalizedCreate(key: string, body: CollectionCreate): VectorCollectionConfig | { error: string } {
  const collection = (body.collection ?? key).trim();
  const model = body.model?.trim();
  const provider = body.provider?.trim() ?? 'none';
  if (!collection) return { error: 'collection must be a non-empty string' };
  if (!model) return { error: 'model must be a non-empty string' };
  if (!provider) return { error: 'provider must be a non-empty string' };
  return {
    collection, model, provider, adapter: body.adapter ?? 'lancedb',
    ...(body.service !== undefined && { service: body.service }),
    ...(body.endpoint !== undefined && { endpoint: body.endpoint }),
    ...(body.enabled !== undefined && { enabled: body.enabled }),
    ...(body.primary !== undefined && { primary: body.primary }),
    ...(body.embedder !== undefined && { embedder: body.embedder }),
  };
}

export function withPrimary(config: VectorServerConfig, primaryKey: string): VectorServerConfig {
  return {
    ...config,
    collections: Object.fromEntries(Object.entries(config.collections).map(([key, col]) => [
      key,
      key === primaryKey ? { ...col, primary: true } : { ...col, primary: false },
    ])),
  };
}

export function withoutCollection(config: VectorServerConfig, removeKey: string): VectorServerConfig {
  const entries = Object.entries(config.collections).filter(([key]) => key !== removeKey);
  if (!entries.some(([, col]) => col.primary) && entries[0]) entries[0][1] = { ...entries[0][1], primary: true };
  return { ...config, collections: Object.fromEntries(entries) };
}
