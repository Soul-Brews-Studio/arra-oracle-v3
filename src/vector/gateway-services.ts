import type { GatewayConfig, ServiceConfig } from '../gateway/config.ts';
import type { RegisteredVectorService } from './service-registry.ts';
import { VECTOR_PROXY_PROTOCOL_VERSION, buildVectorProxyUrl } from './proxy-protocol.ts';

type Capabilities = Record<string, unknown>;

function capabilityString(capabilities: Capabilities | undefined, key: string): string | undefined {
  const value = capabilities?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isHttpEndpoint(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function serviceKey(service: RegisteredVectorService): string {
  return service.name === 'vector' ? 'vector' : `vector:${service.name}`;
}

function healthPath(service: RegisteredVectorService): string {
  const explicit = capabilityString(service.capabilities, 'healthPath');
  if (explicit) return explicit;
  return service.capabilities?.protocol === VECTOR_PROXY_PROTOCOL_VERSION ? '/health' : '/api/vector/health';
}

export function gatewayServicesFromVectorServices(
  services: RegisteredVectorService[],
): Record<string, ServiceConfig> {
  const out: Record<string, ServiceConfig> = {};
  for (const service of services) {
    if (service.type !== 'proxy' || !isHttpEndpoint(service.endpoint)) continue;
    const baseUrl = service.endpoint.replace(/\/+$/, '');
    const timeout = Number(service.capabilities?.timeoutMs);
    out[serviceKey(service)] = {
      url: baseUrl,
      healthCheck: buildVectorProxyUrl(baseUrl, healthPath(service)),
      ...(Number.isFinite(timeout) && timeout > 0 ? { timeout } : {}),
    };
  }
  return out;
}

export function mergeVectorServicesIntoGatewayConfig(
  config: GatewayConfig,
  vectorServices: RegisteredVectorService[] = [],
): GatewayConfig {
  const services = gatewayServicesFromVectorServices(vectorServices);
  if (Object.keys(services).length === 0) return config;
  return { ...config, services: { ...services, ...config.services } };
}
