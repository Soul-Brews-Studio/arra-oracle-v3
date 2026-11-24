/** GET /api/arra/status — loopback only, counts docs per source, reports node config. */
import { beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PEER_IP_HEADER } from '../net.ts';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'arra-status-')));
const dataDir = path.join(root, '.arra');
let routes: { handle(r: Request): Promise<Response> };

beforeAll(async () => {
  const { initArra } = await import('../init.ts');
  initArra({ dir: root, name: 'status-node' });
  process.env.ORACLE_DATA_DIR = dataDir;
  process.env.ORACLE_DB_PATH = path.join(dataDir, 'oracle.db');
  const { sqlite } = await import('../../db/index.ts');
  const now = Date.now();
  const insert = sqlite.query(`INSERT INTO oracle_documents (id, type, source_file, concepts, created_at, updated_at, indexed_at, origin)
    VALUES (?, 'learning', ?, '[]', ?, ?, ?, ?)`);
  insert.run('mine', 'ψ/memory/learnings/mine.md', now, now, now, null);
  insert.run('shared-1', 'hub/soul-brews/a.md', now, now, now, 'hub:soul-brews');
  insert.run('shared-2', 'hub/soul-brews/b.md', now, now, now, 'hub:soul-brews');
  ({ arraRoutes: routes } = await import('../../routes/arra/index.ts'));
}, 60_000);

const get = (headers: Record<string, string> = {}) => routes.handle(new Request('http://local/api/arra/status', { headers }));

describe('GET /api/arra/status', () => {
  test('reports this node and docs per source', async () => {
    const res = await get({ [PEER_IP_HEADER]: '127.0.0.1' });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body.initialized).toBe(true);
    expect(body.name).toBe('status-node');
    expect(body.dataDir).toBe(dataDir);
    expect(body.docs.bySource).toEqual({ 'hub:soul-brews': 2, self: 1 });
    expect(body.docs.total).toBe(3);
    expect(body.hub).toBeNull();
    expect(body.embedder).toHaveProperty('model');
  });

  test('a tailnet peer is refused: /api/arra is the owner\'s', async () => {
    const res = await get({ [PEER_IP_HEADER]: '100.88.1.2' });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toContain('this machine only');
  });
});
