/** GET /api/arra/search groups by source; self: / shared: narrow; read opens one doc. */
import { beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'arra-search-')));
let api: { handle(r: Request): Promise<Response> };

beforeAll(async () => {
  const learn = path.join(root, 'ψ', 'memory', 'learnings');
  fs.mkdirSync(learn, { recursive: true });
  fs.writeFileSync(path.join(learn, 'kiln.md'), '# Kiln notes\nMy kiln fires glaze at cone 6.\n');
  const { initArra } = await import('../init.ts');
  initArra({ dir: root, name: 'search-node' });
  process.env.ORACLE_DATA_DIR = path.join(root, '.arra');
  process.env.ORACLE_DB_PATH = path.join(root, '.arra', 'oracle.db');
  process.env.ORACLE_EMBEDDER = 'none';
  const { sqlite } = await import('../../db/index.ts');
  const { indexVaultFiles } = await import('../vault-index.ts');
  indexVaultFiles(sqlite, 'soul-brews', [{ rel: 'ψ/memory/shared/glaze.md', content: '---\ntitle: Glaze recipe\nshared_by: node-a\n---\nCone 6 clear glaze: silica, kaolin, frit.\n' }]);
  indexVaultFiles(sqlite, 'acme', [{ rel: 'ψ/memory/shared/glaze-2.md', content: '# Glaze test tiles\nTest every glaze on a tile first.\n' }]);
  ({ arraRoutes: api } = await import('../../routes/arra/index.ts'));
}, 60_000);

const get = async (p: string) => {
  const res = await api.handle(new Request(`http://local/api/arra${p}`));
  return { status: res.status, body: await res.json() as Record<string, any> };
};

describe('grouped search', () => {
  test('one group per source, self first, each ranked on its own', async () => {
    const r = await get('/search?q=glaze');
    expect(r.status).toBe(200);
    expect(r.body.groups.map((g: { source: string }) => g.source)).toEqual(['self', 'hub:acme', 'hub:soul-brews']);
    const self = r.body.groups[0];
    expect(self.results[0].title).toBe('Kiln notes');
    const shared = r.body.groups[2];
    expect(shared.ranking).toBe('fts (bm25)');
    expect(shared.results[0]).toMatchObject({ n: 1, title: 'Glaze recipe', id: 'hub:soul-brews:ψ/memory/shared/glaze.md' });
    expect(r.body.notes).toContain('scores compare only within a group');
  });

  test('self: shows only this arra, shared: only hub rows', async () => {
    const self = await get(`/search?q=${encodeURIComponent('self:glaze')}`);
    expect(self.body.groups.map((g: { source: string }) => g.source)).toEqual(['self']);
    const shared = await get(`/search?q=${encodeURIComponent('shared:glaze')}`);
    expect(shared.body.groups.map((g: { source: string }) => g.source)).toEqual(['hub:acme', 'hub:soul-brews']);
    expect(shared.body.scope).toBe('shared');
  });

  test('read opens a synced hub row with who shared it', async () => {
    const r = await get(`/read?id=${encodeURIComponent('hub:soul-brews:ψ/memory/shared/glaze.md')}`);
    expect(r.status).toBe(200);
    expect(r.body.doc).toMatchObject({ source: 'hub:soul-brews', created_by: 'node-a', title: 'Glaze recipe' });
    expect(r.body.doc.content).toContain('silica, kaolin, frit');
    expect((await get('/read?id=nope')).status).toBe(404);
  });
});
