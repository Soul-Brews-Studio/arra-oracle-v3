/** Two tenants whose vaults share relative paths keep separate rows (ids were global and collided). */
import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '../..');
function vault(root: string, text: string) {
  const f = path.join(root, 'ψ', 'memory', 'resonance', 'oracle.md');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `# Oracle\n\n${text}\n`);
}
function index(repo: string, dataDir: string, tenant?: string) {
  const r = Bun.spawnSync(['bun', path.join(ROOT, 'src/indexer/cli.ts'), '--repo-root', repo], {
    cwd: ROOT,
    env: { ...process.env, ORACLE_DATA_DIR: dataDir, ORACLE_DB_PATH: path.join(dataDir, 'oracle.db'), ORACLE_EMBEDDER: 'none', ORACLE_FILE_WATCHER: '0', ...(tenant ? { ORACLE_TENANT_ID: tenant } : { ORACLE_TENANT_ID: '' }) },
  });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString().slice(-800));
}

test('default, mother and pulse with the same ψ/memory/resonance/oracle.md keep their own rows and text', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-ids-'));
  const data = path.join(tmp, 'data');
  fs.mkdirSync(data);
  const repos = ['self', 'mother', 'pulse'].map((n) => { const d = path.join(tmp, n); vault(d, `${n} wisdom`); return d; });
  index(repos[0], data);
  index(repos[1], data, 'mother');
  index(repos[2], data, 'pulse');
  const db = new Database(path.join(data, 'oracle.db'), { readonly: true });
  const byTenant = Object.fromEntries((db.query('SELECT tenant_id t, count(*) n FROM oracle_documents GROUP BY tenant_id').all() as Array<{ t: string; n: number }>).map((r) => [r.t, r.n]));
  expect(byTenant.default).toBeGreaterThan(0);
  expect(byTenant.mother).toBe(byTenant.default);
  expect(byTenant.pulse).toBe(byTenant.default);
  const text = (t: string) => (db.query(`SELECT f.content c FROM oracle_fts f JOIN oracle_documents d ON d.id = f.id WHERE d.tenant_id = ? LIMIT 1`).get(t) as { c: string }).c;
  expect(text('default')).toContain('self wisdom');
  expect(text('mother')).toContain('mother wisdom');
  expect(text('pulse')).toContain('pulse wisdom');
});
