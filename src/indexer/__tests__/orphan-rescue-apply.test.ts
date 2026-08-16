import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  LONG_BODY, makeEnv, planOf, runInitial, runResume, sha256,
} from './orphan-rescue-harness.ts';

const { applyOrphanRescue, classifyRow, computeProtectedSet } = await import('../orphan-rescue-apply.ts');
const { renderRescueFile } = await import('../orphan-rescue-shared.ts');
const { buildJournalHeader, connectedDbRealpath } = await import('../orphan-rescue-journal.ts');
const { enrichTextWithAcronyms } = await import('../../search/acronyms.ts');


describe('Gate C applier — happy paths', () => {
  test('#2/#9: clean --initial end-to-end; protected digest stable; postconditions attached; plan drained', async () => {
    const env = makeEnv([
      { id: 'doc-a', body: 'short body a' },
      { id: 'doc-b', body: 'short body b' },
      { id: 'old-hist', body: 'history', superseded: true },
    ]);
    const manifest = planOf(env);
    expect(manifest.count).toBe(2);

    const check = await applyOrphanRescue({
      sqlite: env.sqlite, manifest, mode: 'check', bundleDir: '',
      journalPath: env.journalPath, expectedProtectedCount: 1,
    });
    expect(check.states.NOT_STARTED).toBe(2);

    const report = await runInitial(env, manifest, 1);
    expect(report.filesWritten).toBe(2);
    expect(report.ingested).toBe(2);
    expect(report.superseded).toBe(2);
    expect(report.protectedDigest).toBe(check.protectedDigest);
    expect(report.postcheck?.activeOrphansRemaining).toBe(0);
    expect(report.postcheck?.totalDocsAfter).toBe(report.postcheck!.totalDocsBefore + 2);

    for (const row of manifest.rows) {
      const dest = path.join(env.canonical, row.newSourceFile);
      expect(sha256(fs.readFileSync(dest, 'utf8'))).toBe(row.renderedFileSha256);
      const newRow = env.sqlite.prepare('SELECT created_by AS c FROM oracle_documents WHERE id = ?').get(row.newId) as { c: string };
      expect(newRow.c).toBe('oracle_recovery');
      const old = env.sqlite.prepare('SELECT superseded_by AS s FROM oracle_documents WHERE id = ?').get(row.oldId) as { s: string };
      expect(old.s).toBe(row.newId);
    }
    // Rescued rows now have on-disk sources => planner finds no active orphans.
    expect(() => planOf(env)).toThrow('no active orphan candidates');
  });

  test('#1: >800-char body stays ONE base newId — no chunk fan-out', async () => {
    const env = makeEnv([{ id: 'doc-long', body: LONG_BODY }]);
    const manifest = planOf(env);
    await runInitial(env, manifest);
    const rows = env.sqlite.prepare("SELECT id FROM oracle_documents WHERE id LIKE 'doc-long-rescue%'").all() as Array<{ id: string }>;
    expect(rows.map(r => r.id)).toEqual(['doc-long-rescue']);
    expect(env.sqlite.prepare("SELECT COUNT(*) AS c FROM oracle_documents WHERE id LIKE '%__chunk_%'").get()).toEqual({ c: 0 });
    const fts = env.sqlite.prepare('SELECT content FROM oracle_fts WHERE id = ?').all('doc-long-rescue') as Array<{ content: string }>;
    expect(fts.length).toBe(1);
    expect(sha256(fts[0].content)).toBe(sha256(enrichTextWithAcronyms(LONG_BODY)));
  });

  test('#5/#15: resume over COMPLETE rows is a pure no-op and protected set stays frozen', async () => {
    const env = makeEnv([
      { id: 'doc-a', body: 'body a' },
      { id: 'old-hist', body: 'history', superseded: true },
    ]);
    const manifest = planOf(env);
    await runInitial(env, manifest, 1);
    const before = computeProtectedSet(env.sqlite, env.canonical, manifest);
    const resumed = await runResume(env, manifest, 1);
    expect(resumed.states.COMPLETE).toBe(1);
    expect(resumed.filesWritten + resumed.ingested + resumed.superseded).toBe(0);
    const after = computeProtectedSet(env.sqlite, env.canonical, manifest);
    expect(after.ids).toEqual(before.ids);           // completed olds never join
    expect(after.ids).toEqual(['old-hist']);
    expect(after.digest).toBe(before.digest);
  });

  test('#3: file present (crash before DB semantics) resumes via FILE_ONLY', async () => {
    const env = makeEnv([{ id: 'doc-a', body: 'body a' }]);
    const manifest = planOf(env);
    const row = manifest.rows[0];
    const rendered = renderRescueFile({ ...row, body: 'body a' });
    const dest = path.join(env.canonical, row.newSourceFile);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, rendered);
    // Journal header written as the crashed initial run would have.
    const { makeBundle } = await import('./orphan-rescue-harness.ts');
    await makeBundle(env);
    const bundleReal = fs.realpathSync(env.bundle);
    const header = buildJournalHeader({
      manifestSha256: manifest.manifestSha256,
      bundleRealpath: bundleReal,
      bundleManifestSha256: sha256(fs.readFileSync(path.join(bundleReal, 'manifest.json'), 'utf8')),
      canonicalRoot: env.canonical,
      dbRealpath: connectedDbRealpath(env.sqlite),
      protectedSet: computeProtectedSet(env.sqlite, env.canonical, manifest),
    }, () => new Date());
    fs.writeFileSync(env.journalPath, `${JSON.stringify(header)}\n`);
    expect(classifyRow(env.sqlite, env.canonical, row).state).toBe('FILE_ONLY');
    const report = await runResume(env, manifest);
    expect(report.filesWritten).toBe(0);
    expect(report.ingested).toBe(1);
    expect(report.superseded).toBe(1);
  });

  test('#4: crash after store before supersede resumes via INGESTED_VERIFIED (supersede only)', async () => {
    const env = makeEnv([{ id: 'doc-a', body: 'body a' }]);
    const manifest = planOf(env);
    await runInitial(env, manifest);
    // Emulate the crash window: undo only the supersede.
    env.sqlite.prepare('UPDATE oracle_documents SET superseded_by = NULL, superseded_at = NULL, superseded_reason = NULL WHERE id = ?').run('doc-a');
    expect(classifyRow(env.sqlite, env.canonical, manifest.rows[0]).state).toBe('INGESTED_VERIFIED');
    const report = await runResume(env, manifest);
    expect(report.filesWritten).toBe(0);
    expect(report.ingested).toBe(0);
    expect(report.superseded).toBe(1);
  });
});
