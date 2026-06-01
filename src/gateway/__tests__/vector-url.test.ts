import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { loadGatewayConfig } from '../config.ts';
import { compileRoutes, matchRoute } from '../matcher.ts';
import { gatewayPlugin } from '../index.ts';

describe('VECTOR_URL synthesized gateway config', () => {
  it('covers the full vector route surface without local-vector fallback', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-gateway-vector-url-'));
    try {
      const cfg = loadGatewayConfig(dir, 'http://vector.local:47779/')!;
      expect(cfg.services.vector.url).toBe('http://vector.local:47779/');
      expect(cfg.services.vector.healthCheck).toBe('http://vector.local:47779/api/vector/health');

      const routes = compileRoutes(cfg.routes);
      expect(matchRoute('/api/search', routes)).toEqual({
        service: 'vector',
        fallback: 'fts5',
        pattern: '/api/search',
      });
      expect(matchRoute('/api/similar', routes)).toEqual({
        service: 'vector',
        fallback: 'error',
        pattern: '/api/similar',
      });
      expect(matchRoute('/api/compare', routes)).toEqual({
        service: 'vector',
        fallback: 'error',
        pattern: '/api/compare',
      });
      expect(matchRoute('/api/map', routes)).toEqual({
        service: 'vector',
        fallback: 'empty',
        pattern: '/api/map',
      });
      expect(matchRoute('/api/map3d', routes)).toEqual({
        service: 'vector',
        fallback: 'empty',
        pattern: '/api/map3d',
      });
      expect(matchRoute('/api/vector/stats', routes)).toEqual({
        service: 'vector',
        fallback: 'error',
        pattern: '/api/vector/**',
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to local FTS5 for search but not local map when VECTOR_URL is down', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-gateway-vector-url-'));
    try {
      const app = new Elysia()
        .use(gatewayPlugin(dir, 'http://127.0.0.1:9'))
        .get('/api/search', () => ({ source: 'local-fts5', results: [] }))
        .get('/api/map', () => ({ source: 'local-vector-map' }));

      const search = await app.handle(new Request('http://localhost/api/search?q=oracle'));
      expect(search.status).toBe(200);
      expect(await search.json()).toEqual({ source: 'local-fts5', results: [] });

      const map = await app.handle(new Request('http://localhost/api/map'));
      expect(map.status).toBe(200);
      expect(await map.json()).toEqual({ results: [], source: 'gateway-fallback' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
