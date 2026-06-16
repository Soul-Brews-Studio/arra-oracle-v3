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

export interface VectorServiceRegistryClient {
  register(service: Omit<RegisteredVectorService, 'name'> & { name: string }): Promise<RegisteredVectorService>;
  discover(): Promise<RegisteredVectorService[]>;
  unregister(name: string): Promise<boolean>;
  healthCheck(): Promise<Map<string, HealthStatus>>;
}

const HEALTH_TIMEOUT_MS = 5_000;

export function vectorServiceUrl(endpoint: string, suffix: string): string {
  const safeBase = endpoint.replace(/\/+$/, '');
  return `${safeBase}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

function activeConfigPath(): string {
  const dataDir = process.env.ORACLE_DATA_DIR;
  return dataDir ? configPath(dataDir) : configPath();
}

function loadActiveConfig(): VectorServerConfig | null {
  return loadVectorConfig(activeConfigPath());
}

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

function normalizeStorage(
  config: VectorServerConfig,
  services: Map<string, RegisteredVectorService>,
): VectorStorageConfig {
  const storageServices: Record<string, VectorStorageService> = {};
  for (const [name, service] of services) {
    storageServices[name] = {
      type: service.type,
      ...(service.endpoint && { endpoint: service.endpoint }),
      ...(service.capabilities && { capabilities: service.capabilities }),
    };
  }

  const defaultService = config.storage?.default
    && services.has(config.storage.default)
    ? config.storage.default
    : 'lancedb';

  return {
    default: defaultService,
    services: storageServices,
  };
}

function syncConfig(
  config: VectorServerConfig,
  services: Map<string, RegisteredVectorService>,
): VectorServerConfig {
  const next = { ...config, storage: normalizeStorage(config, services) };
  writeVectorConfig(next, activeConfigPath());
  return next;
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

export class VectorServiceRegistry implements VectorServiceRegistryClient {
  private currentConfig: VectorServerConfig;
  private registry: Map<string, RegisteredVectorService>;

  constructor(config: VectorServerConfig = loadActiveConfig() ?? generateDefaultConfig()) {
    this.currentConfig = config;
    this.registry = seedFromConfig(config);
  }

  private refresh(): void {
    this.currentConfig = loadActiveConfig() ?? this.currentConfig;
    this.registry = seedFromConfig(this.currentConfig);
  }

  async register(service: RegisteredVectorService): Promise<RegisteredVectorService> {
    this.refresh();
    const normalized = validateService(service);
    this.registry.set(normalized.name, normalized);
    this.currentConfig = syncConfig(this.currentConfig, this.registry);
    return normalized;
  }

  async discover(): Promise<RegisteredVectorService[]> {
    this.refresh();
    if (this.registry.size === 0) this.registry = seedFromConfig(this.currentConfig);

    return [...this.registry.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async unregister(name: string): Promise<boolean> {
    this.refresh();
    const removed = this.registry.delete(name);
    if (removed) this.currentConfig = syncConfig(this.currentConfig, this.registry);
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
        const endpoint = resolveServiceEndpoint(this.currentConfig, service.name) || service.endpoint;
        if (!endpoint) {
          throw new Error('missing endpoint');
        }
        const healthUrl = vectorServiceUrl(endpoint, '/health');
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

export const vectorServiceRegistry = new VectorServiceRegistry();

export async function getRegisteredServiceEndpoint(name: string): Promise<string | undefined> {
  const services = await vectorServiceRegistry.discover();
  const match = services.find((item) => item.name === name);
  return match?.type === 'proxy' ? match.endpoint : undefined;
}
