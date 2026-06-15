/** Storage backend registry and factory. */

import { loadStorageConfig } from './config.ts';
import { createDrizzleSqliteBackend } from './drizzle-sqlite.ts';
import type {
  StorageBackend,
  StorageBackendFactory,
  StorageBackendOptions,
} from './types.ts';

interface CreateStorageBackendOptions extends StorageBackendOptions {
  backend?: string;
}

const defaultFactories = new Map<string, StorageBackendFactory>([
  ['drizzle-sqlite', createDrizzleSqliteBackend],
]);
const factories = new Map(defaultFactories);

export function registerStorageBackend(
  name: string,
  factory: StorageBackendFactory,
): void {
  factories.set(name, factory);
}

export function resetStorageBackendsForTests(): void {
  factories.clear();
  for (const [name, factory] of defaultFactories) factories.set(name, factory);
}

export function createStorageBackend(
  options: CreateStorageBackendOptions = {},
): StorageBackend {
  const backend = options.backend
    || loadStorageConfig({ repoRoot: options.repoRoot, dataDir: options.dataDir }).backend;
  const factory = factories.get(backend);

  if (!factory) {
    throw new Error(
      `Unknown storage backend "${backend}". Register it before selecting it in config.`,
    );
  }

  return factory(options);
}
