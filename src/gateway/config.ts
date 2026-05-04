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
}

const CONFIG_FILE = 'oracle-gateway.json';

export function loadGatewayConfig(dataDir: string, vectorUrl?: string): GatewayConfig | null {
  const configPath = path.join(dataDir, CONFIG_FILE);

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw) as GatewayConfig;
    } catch (e) {
      console.warn(`[Gateway] Failed to parse ${configPath}:`, e);
      return null;
    }
  }

  // Backward compat: synthesize config from VECTOR_URL
  if (vectorUrl) {
    return {
      services: {
        vector: { url: vectorUrl, timeout: 5000 },
      },
      routes: [
        { match: '/api/vector/**', service: 'vector', fallback: 'fts5' },
        { match: '/api/similar', service: 'vector', fallback: 'fts5' },
        { match: '/api/search', service: 'vector', fallback: 'fts5' },
      ],
    };
  }

  return null;
}
