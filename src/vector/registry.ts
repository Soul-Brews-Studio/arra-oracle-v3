/**
 * Service registry for external vector services.
 *
 * Keeps runtime-registered services in-memory and syncs them to
 * vector-server.json under `storage.services`.
 */

import {
  configPath,
  generateDefaultConfig,
  loadVectorConfig,
  resolveServiceEndpoint,
  writeVectorConfig,
  type VectorServerConfig,
  type VectorStorageConfig,
  type VectorStorageService,
} from './config.ts';

export type RegisteredServiceType = 'builtin' | 'proxy';

export interface RegisteredVectorService {
  name: string;
  type: RegisteredServiceType;
  endpoint?: string;
  capabilities?: Record<string, unknown>;
}

export interface HealthStatus {
  status: 'up' | 'down' | 'unknown';
  checkedAt: string;
  responseTimeMs?: number;
  error?: string;
}

export interface VectorServiceRegistry {
  register(service: Omit<RegisteredVectorService, 'name'> & { name: string }): Promise<RegisteredVectorService>;
  discover(): Promise<RegisteredVectorService[]>;
  unregister(name: string): Promise<boolean>;
  healthCheck(): Promise<Map<string, HealthStatus>>;
}

const HEALTH_TIMEOUT_MS = 5_000;

let currentConfig: VectorServerConfig = loadVectorConfig() ?? generateDefaultConfig();
let registry = seedFromConfig(currentConfig);

function seedFromConfig(config: VectorServerConfig): Map<string, RegisteredVectorService> {
  const services = config.storage?.services ?? {
    lancedb: { type: 'builtin' },
  };

  const out = new Map<string, RegisteredVectorService>();
  for (const [name, service] of Object.entries(services)) {
    out.set(name, {
      name,
      type: service.type,
      endpoint: service.endpoint,
      capabilities: service.capabilities,
    });
  }

  if (!out.has('lancedb')) {
    out.set('lancedb', { name: 'lancedb', type: 'builtin' });
  }

  return out;
}

function normalizeStorage(services: Map<string, RegisteredVectorService>): VectorStorageConfig {
  const storageServices: Record<string, VectorStorageService> = {};
  for (const [name, service] of services) {
    storageServices[name] = {
      type: service.type,
      ...(service.endpoint && { endpoint: service.endpoint }),
      ...(service.capabilities && { capabilities: service.capabilities }),
    };
  }

  const defaultService = currentConfig.storage?.default
    && services.has(currentConfig.storage.default)
    ? currentConfig.storage.default
    : 'lancedb';

  return {
    default: defaultService,
    services: storageServices,
  };
}

function syncConfig(services: Map<string, RegisteredVectorService>): void {
  if (!currentConfig.storage) {
    currentConfig.storage = { default: 'lancedb', services: {} };
  }
  currentConfig.storage = normalizeStorage(services);
  writeVectorConfig(currentConfig, configPath());
}

function ensureConfigRefreshed(): void {
  const latest = loadVectorConfig() ?? currentConfig;
  if (latest) {
    currentConfig = latest;
    registry = seedFromConfig(latest);
  }
}

function validateService(service: RegisteredVectorService): RegisteredVectorService {
  const name = service.name?.trim();
  if (!name) throw new Error('service name is required');
  if (!service.type) throw new Error(`service ${name} missing type`);
  if (service.type === 'proxy' && !service.endpoint) {
    throw new Error(`proxy service ${name} requires endpoint`);
  }
  return {
    name,
    type: service.type,
    endpoint: service.endpoint,
    capabilities: service.capabilities,
  };
}

class InMemoryVectorServiceRegistry implements VectorServiceRegistry {
  async register(service: RegisteredVectorService): Promise<RegisteredVectorService> {
    ensureConfigRefreshed();
    const normalized = validateService(service);
    registry.set(normalized.name, normalized);
    syncConfig(registry);
    return normalized;
  }

  async discover(): Promise<RegisteredVectorService[]> {
    if (registry.size === 0) {
      ensureConfigRefreshed();
      if (registry.size === 0) {
        registry = seedFromConfig(currentConfig);
      }
    }

    return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async unregister(name: string): Promise<boolean> {
    ensureConfigRefreshed();
    const removed = registry.delete(name);
    if (removed) syncConfig(registry);
    return removed;
  }

  async healthCheck(): Promise<Map<string, HealthStatus>> {
    const services = await this.discover();
    const results = new Map<string, HealthStatus>();

    await Promise.all(services.map(async (service) => {
      if (service.type === 'builtin') {
        results.set(service.name, { status: 'up', checkedAt: new Date().toISOString() });
        return;
      }

      const started = Date.now();
      try {
        const endpoint = resolveServiceEndpoint(currentConfig, service.name) || service.endpoint;
        if (!endpoint) {
          throw new Error('missing endpoint');
        }
        const healthUrl = new URL('/health', endpoint);
        const response = await fetch(healthUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        });
        results.set(service.name, {
          status: response.ok ? 'up' : 'down',
          checkedAt: new Date().toISOString(),
          responseTimeMs: Date.now() - started,
          error: response.ok ? undefined : `HTTP ${response.status}`,
        });
      } catch (error) {
        results.set(service.name, {
          status: 'down',
          checkedAt: new Date().toISOString(),
          responseTimeMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }));

    return results;
  }
}

export const vectorServiceRegistry = new InMemoryVectorServiceRegistry();

export async function getRegisteredServiceEndpoint(name: string): Promise<string | undefined> {
  const services = await vectorServiceRegistry.discover();
  const match = services.find((item) => item.name === name);
  return match?.type === 'proxy' ? match.endpoint : undefined;
}

