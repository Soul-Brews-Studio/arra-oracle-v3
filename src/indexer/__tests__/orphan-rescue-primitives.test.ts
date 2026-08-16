import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { makeEnv} from './orphan-rescue-harness.ts';

const { storeDocuments } = await import('../storage.ts');
const { runSupersede } = await import('../../tools/supersede.ts');


describe('owner primitive patches', () => {
  test('#7: insertOnly conflict throws inside the transaction — sentinel doc/FTS/entity/pointer bytes unchanged', async () => {
    const env = makeEnv([]);
    const doc = {
      id: 'sentinel', type: 'learning', source_file: 'ψ/memory/learnings/sentinel.md',
      content: 'CROO sentinel content with MAW terms', concepts: ['alpha', 'croo'],
      created_at: 1000, updated_at: 2000, chunk_index: 0, line_start: 1, line_end: 1,
    };
    await storeDocuments(env.sqlite, env.db, null, 'github.com/ttt3p/nntn', [doc as never], { tenantId: 'default' });
    const snapshot = () => ({
      doc: env.sqlite.prepare('SELECT * FROM oracle_documents WHERE id = ?').all('sentinel'),
      fts: env.sqlite.prepare('SELECT * FROM oracle_fts WHERE id = ?').all('sentinel'),
      links: env.sqlite.prepare("SELECT * FROM oracle_entity_links WHERE document_id = 'sentinel'").all(),
      pointers: env.sqlite.prepare("SELECT * FROM oracle_pointer_index WHERE doc_ids LIKE '%sentinel%' ORDER BY id").all(),
    });
    const before = JSON.stringify(snapshot());
    await expect(storeDocuments(env.sqlite, env.db, null, 'github.com/ttt3p/nntn',
      [{ ...doc, content: 'ATTACKER OVERWRITE' } as never],
      { tenantId: 'default', insertOnly: true, createdBy: 'oracle_recovery' },
    )).rejects.toThrow('already exists — refusing to overwrite');
    expect(JSON.stringify(snapshot())).toBe(before);
  });

  test('#12: default paths unchanged — upsert still upserts, plain supersede still non-CAS', async () => {
    const env = makeEnv([]);
    const doc = {
      id: 'up-doc', type: 'learning', source_file: 'ψ/memory/learnings/up.md',
      content: 'v1', concepts: [], created_at: 1, updated_at: 2, chunk_index: 0, line_start: 1, line_end: 1,
    };
    await storeDocuments(env.sqlite, env.db, null, null, [doc as never], { tenantId: 'default' });
    await storeDocuments(env.sqlite, env.db, null, null, [{ ...doc, content: 'v2' } as never], { tenantId: 'default' });
    const fts = env.sqlite.prepare('SELECT content FROM oracle_fts WHERE id = ?').all('up-doc') as Array<{ content: string }>;
    expect(fts.length).toBe(1);
    expect(fts[0].content).toContain('v2');

    env.sqlite.prepare(`INSERT INTO oracle_documents (id, tenant_id, type, source_file, concepts, created_at, updated_at, indexed_at)
      VALUES ('plain-old', 'default', 'learning', 'a.md', '[]', 1, 1, 1), ('plain-new', 'default', 'learning', 'b.md', '[]', 1, 1, 1)`).run();
    const ok = runSupersede(env.db, { oldId: 'plain-old', newId: 'plain-new' });
    expect((ok.payload as { success: boolean }).success).toBe(true);
  });

  test('expectActive refuses a non-active old row and leaves the competing pointer intact', async () => {
    const env = makeEnv([]);
    env.sqlite.prepare(`INSERT INTO oracle_documents (id, tenant_id, type, source_file, concepts, created_at, updated_at, indexed_at, superseded_by, superseded_at)
      VALUES ('doc-a', 'default', 'learning', 'a.md', '[]', 1, 1, 1, 'someone-else', 9),
             ('the-new', 'default', 'learning', 'x.md', '[]', 1, 1, 1, NULL, NULL)`).run();
    const result = runSupersede(env.db, { oldId: 'doc-a', newId: 'the-new', expectActive: true } as never);
    expect(result.isError).toBe(true);
    const old = env.sqlite.prepare('SELECT superseded_by AS s FROM oracle_documents WHERE id = ?').get('doc-a') as { s: string };
    expect(old.s).toBe('someone-else');
  });

  test('#14: expectActive runs check+CAS atomically and still refuses cycles', async () => {
    const env = makeEnv([]);
    // new-doc is already superseded by old-doc => superseding old-doc with new-doc would create a cycle.
    env.sqlite.prepare(`INSERT INTO oracle_documents (id, tenant_id, type, source_file, concepts, created_at, updated_at, indexed_at, superseded_by, superseded_at)
      VALUES ('old-doc', 'default', 'learning', 'a.md', '[]', 1, 1, 1, NULL, NULL),
             ('new-doc', 'default', 'learning', 'b.md', '[]', 1, 1, 1, 'old-doc', 5)`).run();
    const result = runSupersede(env.db, { oldId: 'old-doc', newId: 'new-doc', expectActive: true } as never);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.payload)).toContain('cycle');
    const old = env.sqlite.prepare('SELECT superseded_by AS s FROM oracle_documents WHERE id = ?').get('old-doc') as { s: string | null };
    expect(old.s).toBeNull();

    // Happy CAS path inside the transaction.
    env.sqlite.prepare("UPDATE oracle_documents SET superseded_by = NULL, superseded_at = NULL WHERE id = 'new-doc'").run();
    const ok = runSupersede(env.db, { oldId: 'old-doc', newId: 'new-doc', expectActive: true } as never);
    expect((ok.payload as { success: boolean }).success).toBe(true);
  });

  test('P2: CLI accepts explicit --check and rejects unknown flags', async () => {
    const { parseApplyCliArgs } = await import('../../scripts/apply-orphan-rescue.ts');
    const parsed = parseApplyCliArgs(['--manifest', 'm.json', '--check']);
    expect(parsed.initial).toBe(false);
    expect(parsed.resume).toBe(false);
    expect(() => parseApplyCliArgs(['--nonsense'])).toThrow('unknown option');
    expect(() => parseApplyCliArgs(['--initial'])).toThrow('require explicit --apply');
  });
});
