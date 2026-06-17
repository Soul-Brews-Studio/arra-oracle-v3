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
import { CapabilityRegistry } from './capability-registry.ts';
import { VECTOR_PROXY_PROTOCOL_VERSION, VECTOR_PROXY_ROUTES, buildVectorProxyUrl } from './proxy-protocol.ts';

export const VECTOR_CAPABILITY_KIND = 'vector';
export type RegisteredServiceType = 'builtin' | 'proxy';
export { buildVectorProxyUrl as vectorServiceUrl } from './proxy-protocol.ts';

export interface RegisteredVectorService {
  kind?: typeof VECTOR_CAPABILITY_KIND;
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
  name?: string;
  version?: string;
  protocol?: string;
  compatible?: boolean;
}

export interface VectorServiceRegistryClient {
  register(service: Omit<RegisteredVectorService, 'name'> & { name: string }): Promise<RegisteredVectorService>;
  discover(): Promise<RegisteredVectorService[]>;
  unregister(name: string): Promise<boolean>;
  healthCheck(): Promise<Map<string, HealthStatus>>;
}

const HEALTH_TIMEOUT_MS = 5_000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function protocolError(protocol: string | undefined, expectedProtocol?: string): string | undefined {
  if (expectedProtocol && protocol !== expectedProtocol) {
    return `protocol mismatch: expected ${expectedProtocol}, got ${protocol ?? 'missing'}`;
  }
  if (!expectedProtocol && protocol && protocol !== VECTOR_PROXY_PROTOCOL_VERSION) {
    return `unsupported proxy protocol ${protocol}`;
  }
  return undefined;
}

async function readProxyHealth(response: Response, expectedProtocol?: string): Promise<Partial<HealthStatus>> {
  const body = record(await response.json().catch(() => ({})));
  const proxyOk = body.status === 'ok';
  const protocol = typeof body.protocol === 'string' ? body.protocol : undefined;
  const mismatch = protocolError(protocol, expectedProtocol);
  return {
    status: response.ok && proxyOk && !mismatch ? 'up' : 'down',
    name: typeof body.name === 'string' ? body.name : undefined,
    version: typeof body.version === 'string' ? body.version : undefined,
    protocol,
    compatible: !mismatch,
    error: mismatch ?? (response.ok && !proxyOk
      ? `health status ${String(body.status ?? 'missing')}`
      : response.ok ? undefined : `HTTP ${response.status}`),
  };
}

function activeConfigPath(): string {
  const dataDir = process.env.ORACLE_DATA_DIR;
  return dataDir ? configPath(dataDir) : configPath();
}

function loadActiveConfig(): VectorServerConfig | null {
  return loadVectorConfig(activeConfigPath());
}

function seedFromConfig(config: VectorServerConfig): Map<string, RegisteredVectorService> {
  const services = config.storage?.services ?? { lancedb: { type: 'builtin' } };
  const out = new Map<string, RegisteredVectorService>();
  for (const [name, service] of Object.entries(services)) {
    out.set(name, { kind: VECTOR_CAPABILITY_KIND, name, type: service.type, endpoint: service.endpoint, capabilities: service.capabilities });
  }
  if (!out.has('lancedb')) out.set('lancedb', { kind: VECTOR_CAPABILITY_KIND, name: 'lancedb', type: 'builtin' });
  return out;
}

function normalizeStorage(
  config: VectorServerConfig,
  services: RegisteredVectorService[],
): VectorStorageConfig {
  const storageServices: Record<string, VectorStorageService> = {};
  for (const service of services) {
    storageServices[service.name] = {
      type: service.type,
      ...(service.endpoint && { endpoint: service.endpoint }),
      ...(service.capabilities && { capabilities: service.capabilities }),
    };
  }
  const defaultService = config.storage?.default && services.some((service) => service.name === config.storage?.default)
    ? config.storage.default
    : 'lancedb';
  return { default: defaultService, services: storageServices };
}

function syncConfig(
  config: VectorServerConfig,
  services: RegisteredVectorService[],
): VectorServerConfig {
  const version: VectorServerConfig['version'] = config.version.startsWith('2') ? config.version : '2.0';
  const next = { ...config, version, storage: normalizeStorage(config, services) };
  writeVectorConfig(next, activeConfigPath());
  return next;
}

function validateService(service: RegisteredVectorService): RegisteredVectorService {
  const name = service.name?.trim();
  const capabilities = record(service.capabilities);
  if (!name) throw new Error('service name is required');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) throw new Error(`invalid service name: ${name}`);
  if (service.kind && service.kind !== VECTOR_CAPABILITY_KIND) throw new Error(`unsupported service kind: ${String(service.kind)}`);
  if (!service.type) throw new Error(`service ${name} missing type`);
  if (service.type !== 'builtin' && service.type !== 'proxy') throw new Error(`unsupported service type: ${String(service.type)}`);
  const endpoint = service.endpoint?.trim().replace(/\/+$/, '');
  if (service.type === 'proxy') {
    if (!endpoint) throw new Error(`proxy service ${name} requires endpoint`);
    try {
      const protocol = new URL(endpoint).protocol;
      if (protocol !== 'http:' && protocol !== 'https:') throw new Error('bad protocol');
    } catch {
      throw new Error(`proxy service ${name} requires http(s) endpoint`);
    }
  }
  return { kind: VECTOR_CAPABILITY_KIND, name, type: service.type, endpoint, ...(Object.keys(capabilities).length && { capabilities }) };
}

export class VectorServiceRegistry implements VectorServiceRegistryClient {
  private currentConfig: VectorServerConfig;
  private registry: CapabilityRegistry<RegisteredVectorService & { kind: typeof VECTOR_CAPABILITY_KIND }, HealthStatus>;

  constructor(config: VectorServerConfig = loadActiveConfig() ?? generateDefaultConfig()) {
    this.currentConfig = config;
    this.registry = this.createRegistry();
    this.resetRegistry(config);
  }

  private refresh(): void {
    this.currentConfig = loadActiveConfig() ?? this.currentConfig;
    this.resetRegistry(this.currentConfig);
  }

  private createRegistry() {
    return new CapabilityRegistry<RegisteredVectorService & { kind: typeof VECTOR_CAPABILITY_KIND }, HealthStatus>({
      [VECTOR_CAPABILITY_KIND]: (service) => this.checkService(service),
    });
  }

  private resetRegistry(config: VectorServerConfig): void {
    this.registry.clear(VECTOR_CAPABILITY_KIND);
    for (const service of seedFromConfig(config).values()) {
      this.registry.register(service as RegisteredVectorService & { kind: typeof VECTOR_CAPABILITY_KIND });
    }
  }

  private services(): RegisteredVectorService[] {
    return this.registry.discover(VECTOR_CAPABILITY_KIND).sort((a, b) => a.name.localeCompare(b.name));
  }

  async register(service: RegisteredVectorService): Promise<RegisteredVectorService> {
    this.refresh();
    const normalized = validateService(service);
    this.registry.register(normalized as RegisteredVectorService & { kind: typeof VECTOR_CAPABILITY_KIND });
    this.currentConfig = syncConfig(this.currentConfig, this.services());
    return normalized;
  }

  async discover(): Promise<RegisteredVectorService[]> {
    return this.discoverSync();
  }

  discoverSync(): RegisteredVectorService[] {
    this.refresh();
    return this.services();
  }

  async unregister(name: string): Promise<boolean> {
    this.refresh();
    const removed = this.registry.unregister(VECTOR_CAPABILITY_KIND, name);
    if (removed) this.currentConfig = syncConfig(this.currentConfig, this.services());
    return removed;
  }

  async healthCheck(): Promise<Map<string, HealthStatus>> {
    this.refresh();
    return this.registry.healthCheck(VECTOR_CAPABILITY_KIND);
  }

  private async checkService(service: RegisteredVectorService): Promise<HealthStatus> {
    if (service.type === 'builtin') return { status: 'up', checkedAt: new Date().toISOString() };
    const started = Date.now();
    try {
      const endpoint = resolveServiceEndpoint(this.currentConfig, service.name) || service.endpoint;
      if (!endpoint) throw new Error('missing endpoint');
      const expectedProtocol = typeof service.capabilities?.protocol === 'string' ? service.capabilities.protocol : undefined;
      const response = await fetch(buildVectorProxyUrl(endpoint, VECTOR_PROXY_ROUTES.health), {
        method: 'GET',
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      const proxyHealth = await readProxyHealth(response, expectedProtocol);
      return {
        status: proxyHealth.status ?? 'unknown',
        checkedAt: new Date().toISOString(),
        responseTimeMs: Date.now() - started,
        error: proxyHealth.error,
        name: proxyHealth.name,
        version: proxyHealth.version,
        protocol: proxyHealth.protocol,
        compatible: proxyHealth.compatible,
      };
    } catch (error) {
      return {
        status: 'down',
        checkedAt: new Date().toISOString(),
        responseTimeMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export const vectorServiceRegistry = new VectorServiceRegistry();

export async function getRegisteredServiceEndpoint(name: string): Promise<string | undefined> {
  const services = await vectorServiceRegistry.discover();
  const match = services.find((item) => item.name === name);
  return match?.type === 'proxy' ? match.endpoint : undefined;
}
