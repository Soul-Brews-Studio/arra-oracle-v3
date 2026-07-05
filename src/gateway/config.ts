/**
 * Gateway configuration loader.
 *
 * Reads `oracle-gateway.json` from ORACLE_DATA_DIR.
 * If the file is missing, returns null (all routes stay local).
 * If VECTOR_URL is set but no config file exists, auto-generates
 * a gateway config that proxies vector routes to VECTOR_URL.
 */
import fs from 'fs';
import path from 'path';
import type { HooksConfig } from './hooks.ts';
import { mergeVectorServicesIntoGatewayConfig } from '../vector/gateway-services.ts';
import { vectorServiceRegistry, type RegisteredVectorService } from '../vector/service-registry.ts';

export interface ServiceConfig {
  url: string;
  healthCheck?: string;
  timeout?: number;
}

export interface RouteConfig {
  match: string;
  service: string;
  fallback?: 'fts5' | 'empty' | 'error';
}

export interface GatewayConfig {
  services: Record<string, ServiceConfig>;
  routes: RouteConfig[];
  hooks?: HooksConfig;
  /**
   * Per-hook options keyed by hook name. Each hook reads its own slot via
   * `ctx.meta.hook_options[<name>]`. Optional — hooks should provide sensible
   * defaults when missing.
   */
  hook_options?: Record<string, unknown>;
}

function configFileName(): string { return 'oracle-gateway.json'; }

function discoveredVectorServices(): RegisteredVectorService[] {
  return vectorServiceRegistry.discoverSync();
}
export { discoveredVectorServices as discoverGatewayVectorServices };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function loadGatewayConfig(
  dataDir: string,
  vectorUrl?: string,
  vectorServices: RegisteredVectorService[] = [],
): GatewayConfig | null {
  const configPath = path.join(dataDir, configFileName());

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return mergeVectorServicesIntoGatewayConfig(JSON.parse(raw) as GatewayConfig, vectorServices);
    } catch (e) {
      console.warn(`[Gateway] Failed to parse ${configPath}:`, e);
      return null;
    }
  }

  // Backward compat: synthesize config from VECTOR_URL. Search can
  // fall through to local FTS5 when the vector service is unreachable. Map3D
  // stays local because the memory globe must reflect the full DB/FTS corpus,
  // not a partial vector collection.
  if (vectorUrl) {
    const vectorBase = vectorUrl.replace(/\/+$/, '');
    return mergeVectorServicesIntoGatewayConfig({
      services: {
        vector: {
          url: vectorUrl,
          healthCheck: `${vectorBase}/api/vector/health`,
          timeout: 5000,
        },
      },
      routes: [
        { match: '/api/search', service: 'vector', fallback: 'fts5' },
        { match: '/api/similar', service: 'vector', fallback: 'error' },
        { match: '/api/compare', service: 'vector', fallback: 'error' },
        { match: '/api/map', service: 'vector', fallback: 'empty' },
        { match: '/api/vector/**', service: 'vector', fallback: 'error' },
      ],
    }, vectorServices);
  }

  const vectorOnly = mergeVectorServicesIntoGatewayConfig({ services: {}, routes: [] }, vectorServices);
  if (Object.keys(vectorOnly.services).length > 0) return vectorOnly;
  return null;
}

/**
 * Watch the gateway config file and invoke onChange when content changes.
 * Mirrors watchToolGroupConfig: fs.watch + 200ms debounce + no-op suppression
 * + malformed-JSON survival + directory-fallback for first-time creation.
 * VECTOR_URL synthesis is preserved on reload (used when the file is absent).
 * Returns a stop function.
 */
export function watchGatewayConfig(
  dataDir: string,
  onChange: (next: GatewayConfig | null) => void,
  vectorUrl?: string,
  vectorServices: () => RegisteredVectorService[] = () => [],
): () => void {
  const configPath = path.join(dataDir, configFileName());
  const watchers: fs.FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let poller: ReturnType<typeof setInterval> | null = null;
  let last = JSON.stringify(loadGatewayConfig(dataDir, vectorUrl, vectorServices()));

  const reloadIfChanged = (): void => {
    // Malformed JSON survival: if the file exists but failed to parse,
    // loadGatewayConfig returns null AND prints a warning. We only swap
    // the live state when the new result is either a valid config or a
    // genuine deletion (file no longer exists). Mid-edit syntax errors
    // are silently ignored so the running gateway keeps its last good
    // state until the user saves a valid file.
    const fileMissing = !fs.existsSync(configPath);
    const next = loadGatewayConfig(dataDir, vectorUrl, vectorServices());
    if (next === null && !fileMissing) {
      // file exists but failed to parse — hold last good
      return;
    }
    const serialized = JSON.stringify(next);
    if (serialized === last) return;
    console.log('[Gateway] Config changed — reloading');
    try {
      onChange(next);
      last = serialized;
    } catch (error) {
      console.warn(`[Gateway] Config reload callback failed: ${errorMessage(error)}`);
    }
  };

  const tick = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      reloadIfChanged();
    }, 200);
  };

  // fs.watch can drop create/delete events under raw `bun test` load. Polling
  // the resolved config keeps no-op writes silent while making creation tests
  // deterministic.
  poller = setInterval(reloadIfChanged, 100);
  poller.unref?.();

  try {
    if (fs.existsSync(dataDir)) {
      // Always watch the directory: file watchers may miss unlink/replace
      // events for a directly watched file on some platforms.
      watchers.push(
        fs.watch(dataDir, { persistent: false }, (_event, filename) => {
          if (filename === configFileName()) tick();
        }),
      );
    }
    if (fs.existsSync(configPath)) {
      watchers.push(fs.watch(configPath, { persistent: false }, tick));
    }
  } catch {
    // fs.watch can fail on platforms without inotify — keep going.
  }

  return () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (poller) {
      clearInterval(poller);
      poller = null;
    }
    for (const w of watchers) {
      try {
        w.close();
      } catch {}
    }
  };
}
