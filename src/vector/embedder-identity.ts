import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ORACLE_DATA_DIR } from '../config.ts';
import type { EmbeddingProvider, VectorStoreAdapter } from './types.ts';

export type EmbedderIdentity = { model_name: string; dimension: number };
type RegistryEntry = EmbedderIdentity & { adapter: string; collection: string; updated_at: string };
type Registry = { version: 1; collections: Record<string, RegistryEntry> };
type Policy = 'error' | 'warn';

type GuardOptions = {
  adapterName: string;
  collectionName: string;
  embedder: Pick<EmbeddingProvider, 'name' | 'dimensions'>;
  modelName?: string;
  storagePath?: string;
  registryPath?: string;
  policy?: Policy;
  logger?: Pick<Console, 'warn'>;
};

export function withEmbedderIdentityGuard<T extends VectorStoreAdapter>(adapter: T, options: GuardOptions): T {
  const guard = new EmbedderIdentityGuard(options);
  const connect = adapter.connect.bind(adapter);
  const ensureCollection = adapter.ensureCollection.bind(adapter);
  const deleteCollection = adapter.deleteCollection.bind(adapter);
  let checked = false;

  async function checkOnce() {
    if (checked) return;
    await guard.check();
    checked = true;
  }

  adapter.connect = async () => { await connect(); await checkOnce(); };
  adapter.ensureCollection = async () => { await ensureCollection(); await checkOnce(); };
  adapter.deleteCollection = async () => {
    await deleteCollection();
    guard.clear();
    checked = false;
  };
  return adapter;
}

export class EmbedderIdentityGuard {
  private readonly entry: RegistryEntry;
  private readonly key: string;
  private readonly registryPath: string;
  private readonly policy: Policy;
  private readonly logger: Pick<Console, 'warn'>;

  constructor(private readonly options: GuardOptions) {
    const identity = embedderIdentity(options.embedder, options.modelName);
    this.key = registryKey(options.adapterName, options.collectionName, options.storagePath);
    this.registryPath = options.registryPath ?? registryPathFor(options.storagePath);
    this.policy = options.policy ?? policyFromEnv();
    this.logger = options.logger ?? console;
    this.entry = {
      ...identity,
      adapter: options.adapterName,
      collection: options.collectionName,
      updated_at: new Date().toISOString(),
    };
  }

  async check(): Promise<void> {
    const registry = readRegistry(this.registryPath);
    const existing = registry.collections[this.key];
    if (!existing) {
      registry.collections[this.key] = this.entry;
      writeRegistry(this.registryPath, registry);
      return;
    }
    if (sameIdentity(existing, this.entry)) return;
    const message = mismatchMessage(existing, this.entry);
    if (this.policy === 'warn') {
      this.logger.warn(`[VectorIdentity] ${message}`);
      return;
    }
    throw new Error(message);
  }

  clear(): void {
    const registry = readRegistry(this.registryPath);
    delete registry.collections[this.key];
    writeRegistry(this.registryPath, registry);
  }
}

export function embedderIdentity(embedder: Pick<EmbeddingProvider, 'name' | 'dimensions'>, modelName?: string): EmbedderIdentity {
  const model = clean(modelName) ?? defaultModelName(embedder.name) ?? embedder.name;
  return { model_name: model, dimension: Math.trunc(embedder.dimensions) };
}

export function registryPathFor(storagePath?: string): string {
  const configured = clean(process.env.ORACLE_VECTOR_IDENTITY_PATH);
  if (configured) return configured;
  if (!storagePath) return path.join(ORACLE_DATA_DIR, 'vector-identity.json');
  if (isHttpUrl(storagePath)) return path.join(ORACLE_DATA_DIR, 'vector-identity.json');
  return looksLikeFile(storagePath)
    ? `${storagePath}.embedder-identity.json`
    : path.join(storagePath, '.embedder-identity.json');
}

function registryKey(adapter: string, collection: string, storagePath?: string): string {
  const raw = `${adapter}\0${collection}\0${storagePath ?? ''}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function readRegistry(file: string): Registry {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Registry;
    if (parsed.version === 1 && parsed.collections && typeof parsed.collections === 'object') return parsed;
  } catch {}
  return { version: 1, collections: {} };
}

function writeRegistry(file: string, registry: Registry): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function sameIdentity(a: EmbedderIdentity, b: EmbedderIdentity): boolean {
  return a.model_name === b.model_name && a.dimension === b.dimension;
}

function mismatchMessage(existing: RegistryEntry, current: RegistryEntry): string {
  return `Vector collection '${current.collection}' embedder mismatch: `
    + `persisted ${existing.model_name} (${existing.dimension} dims), `
    + `current ${current.model_name} (${current.dimension} dims). `
    + 'Delete/reindex the collection or set ORACLE_VECTOR_IDENTITY_MISMATCH=warn to override.';
}

function policyFromEnv(): Policy {
  return process.env.ORACLE_VECTOR_IDENTITY_MISMATCH?.trim().toLowerCase() === 'warn' ? 'warn' : 'error';
}

function defaultModelName(provider: string): string | undefined {
  const first = provider.split('>')[0];
  return ({
    ollama: 'nomic-embed-text',
    local: 'nomic-embed-text',
    openai: 'text-embedding-3-small',
    gemini: 'text-embedding-004',
    'cloudflare-ai': '@cf/baai/bge-m3',
    'chromadb-internal': 'chromadb-internal',
    none: 'none',
  } as Record<string, string | undefined>)[first];
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function looksLikeFile(value: string): boolean {
  return Boolean(path.extname(value));
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
