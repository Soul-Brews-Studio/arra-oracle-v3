import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGatewayConfig } from '../config.ts';

describe('gateway vector service table feed', () => {
  test('adds discovered vector proxy services without adding unsafe routes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arra-gateway-vector-services-'));
    try {
      const cfg = loadGatewayConfig(dir, undefined, [{
        kind: 'vector',
        name: 'sidecar',
        type: 'proxy',
        endpoint: 'http://127.0.0.1:47779/',
        capabilities: { protocol: 'vector-proxy-v1' },
      }])!;

      expect(cfg.routes).toEqual([]);
      expect(cfg.services['vector:sidecar']).toEqual({
        url: 'http://127.0.0.1:47779',
        healthCheck: 'http://127.0.0.1:47779/health',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('keeps explicit VECTOR_URL route proxy and appends discovered services', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arra-gateway-vector-services-'));
    try {
      const cfg = loadGatewayConfig(dir, 'http://vector.local:47778', [{
        kind: 'vector',
        name: 'storage-proxy',
        type: 'proxy',
        endpoint: 'https://vectors.example',
        capabilities: { protocol: 'vector-proxy-v1', timeoutMs: 7000 },
      }])!;

      expect(cfg.services.vector.healthCheck).toBe('http://vector.local:47778/api/vector/health');
      expect(cfg.services['vector:storage-proxy']).toEqual({
        url: 'https://vectors.example',
        healthCheck: 'https://vectors.example/health',
        timeout: 7000,
      });
      expect(cfg.routes.some((route) => route.service === 'vector')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
