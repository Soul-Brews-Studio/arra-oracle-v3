/** GET /api/arra/ontology and /api/arra/graph: owner only, Ossie document by default. */
import { beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Elysia } from 'elysia';
import { PEER_IP_HEADER } from '../net.ts';
import { createResponseFormatMiddleware } from '../../middleware/response-format.ts';

let routes: { handle(r: Request): Promise<Response> };

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-graph-route-'));
  process.env.ORACLE_DATA_DIR = dir;
  process.env.ORACLE_DB_PATH = path.join(dir, 'oracle.db');
  ({ arraRoutes: routes } = await import('../../routes/arra/index.ts'));
}, 60_000);

const get = (url: string, ip = '127.0.0.1') => routes.handle(new Request(`http://local${url}`, { headers: { [PEER_IP_HEADER]: ip } }));

describe('ontology and graph routes', () => {
  test('ontology defaults to the Ossie document', async () => {
    for (const url of ['/api/arra/ontology', '/api/arra/ontology?format=ossie']) {
      const body = await (await get(url)).json() as Record<string, any>;
      expect(body.version).toBe('0.3.0.dev0');
      expect(body.name).toBe('ArraMemory');
      expect(Array.isArray(body.ontology)).toBe(true);
      expect(body.ok).toBeUndefined();
    }
  });
  test('through the server envelope the Ossie export stays a bare document', async () => {
    const app = new Elysia().use(createResponseFormatMiddleware()).use(routes as never);
    const res = await app.handle(new Request('http://local/api/arra/ontology?format=ossie', { headers: { [PEER_IP_HEADER]: '127.0.0.1' } }));
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['annotations', 'description', 'name', 'ontology', 'version']);
  });
  test('format=graph gives the schema graph; unknown formats are rejected', async () => {
    const body = await (await get('/api/arra/ontology?format=graph')).json() as Record<string, any>;
    expect(body.ok).toBe(true);
    expect(body.nodes.length).toBeGreaterThan(5);
    expect((await get('/api/arra/ontology?format=owl')).status).toBeGreaterThanOrEqual(400);
  });
  test('graph answers on an empty arra', async () => {
    const body = await (await get('/api/arra/graph?limit=10')).json() as Record<string, any>;
    expect(body.ok).toBe(true);
    expect(body.nodes).toEqual([]);
    expect(body.omitted).toEqual({ documents: 0, concepts: 0 });
  });
  test('a tailnet peer gets 403 on both', async () => {
    expect((await get('/api/arra/ontology', '100.64.0.9')).status).toBe(403);
    expect((await get('/api/arra/graph', '100.64.0.9')).status).toBe(403);
  });
});
