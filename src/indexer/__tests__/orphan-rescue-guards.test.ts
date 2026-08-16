import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { makeEnv, makeBundle, planOf, runInitial, runResume} from './orphan-rescue-harness.ts';

const { applyOrphanRescue, classifyRow, RescueApplyDenied } = await import('../orphan-rescue-apply.ts');
const { renderRescueFile } = await import('../orphan-rescue-shared.ts');
const { runPostconditions, totalDocuments } = await import('../orphan-rescue-postcheck.ts');


describe('Gate C applier — fail-closed denials', () => {
  test('#6: foreign file at destination (wrong sha) aborts', async () => {
    const env = makeEnv([{ id: 'doc-a', body: 'body a' }]);
    const manifest = planOf(env);
    const dest = path.join(env.canonical, manifest.rows[0].newSourceFile);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, 'not the rendered bytes');
    await expect(runInitial(env, manifest)).rejects.toThrow('foreign file at destination');
  });

  test('#11: correct-hash preexisting destination rejected in --initial (RESUME-only acceptance)', async () => {
    const env = makeEnv([{ id: 'doc-a', body: 'body a' }]);
    const manifest = planOf(env);
    const row = manifest.rows[0];
    const dest = path.join(env.canonical, row.newSourceFile);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, renderRescueFile({ ...row, body: 'body a' }));
    await expect(runInitial(env, manifest)).rejects.toThrow('initial mode requires every row NOT_STARTED');
  });

  test('#13: DB-complete but file missing is INVALID, hard abort', async () => {
    const env = makeEnv([{ id: 'doc-a', body: 'body a' }]);
    const manifest = planOf(env);
    await runInitial(env, manifest);
    fs.rmSync(path.join(env.canonical, manifest.rows[0].newSourceFile));
    const cls = classifyRow(env.sqlite, env.canonical, manifest.rows[0]);
    expect(cls.state).toBe('INVALID');
    expect(cls.detail).toContain('file missing');
    await expect(runResume(env, manifest)).rejects.toThrow('INVALID');
  });

  test('#8/#10: competing supersede and non-default tenant are refused before any write', async () => {
    const env = makeEnv([{ id: 'doc-a', body: 'body a' }, { id: 'doc-b', body: 'body b' }]);
    const manifest = planOf(env);
    env.sqlite.prepare("UPDATE oracle_documents SET superseded_by = 'someone-else', superseded_at = 9 WHERE id = 'doc-a'").run();
    expect(classifyRow(env.sqlite, env.canonical, manifest.rows[0]).detail).toContain('superseded by someone-else');
    env.sqlite.prepare("UPDATE oracle_documents SET superseded_by = NULL, superseded_at = NULL WHERE id = 'doc-a'").run();
    env.sqlite.prepare("UPDATE oracle_documents SET tenant_id = 'other-tenant' WHERE id = 'doc-b'").run();
    await expect(runInitial(env, manifest)).rejects.toThrow('tenant other-tenant is not default');
    expect(fs.existsSync(path.join(env.canonical, manifest.rows[0].newSourceFile))).toBe(false);
  });

  test('recovery-row metadata drift after ingest classifies INVALID (concepts/timestamps/tenant checked)', async () => {
    const env = makeEnv([{ id: 'doc-a', body: 'body a' }]);
    const manifest = planOf(env);
    await runInitial(env, manifest);
    env.sqlite.prepare("UPDATE oracle_documents SET concepts = '[\"tampered\"]' WHERE id = 'doc-a-rescue'").run();
    const cls = classifyRow(env.sqlite, env.canonical, manifest.rows[0]);
    expect(cls.state).toBe('INVALID');
    expect(cls.detail).toContain('row/FTS incorrect');
    await expect(runResume(env, manifest)).rejects.toThrow('INVALID');
  });

  test('old-row metadata drift from manifest classifies INVALID (project / concepts-only / timestamp-only)', async () => {
    const env = makeEnv([{ id: 'doc-a', body: 'body a' }]);
    const manifest = planOf(env);
    const drift = (sql: string) => {
      env.sqlite.prepare(sql).run();
      return classifyRow(env.sqlite, env.canonical, manifest.rows[0]);
    };
    expect(drift("UPDATE oracle_documents SET project = 'github.com/other/moved' WHERE id = 'doc-a'").detail).toContain('metadata drifted');
    env.sqlite.prepare("UPDATE oracle_documents SET project = 'github.com/ttt3p/nntn' WHERE id = 'doc-a'").run();
    expect(drift(`UPDATE oracle_documents SET concepts = '["alpha","injected"]' WHERE id = 'doc-a'`).detail).toContain('metadata drifted');
    env.sqlite.prepare(`UPDATE oracle_documents SET concepts = '["alpha"]' WHERE id = 'doc-a'`).run();
    expect(drift("UPDATE oracle_documents SET created_at = 999 WHERE id = 'doc-a'").detail).toContain('metadata drifted');
  });

  test('new-row appended-extra concept classifies INVALID; parser-extracted concepts stay green', async () => {
    const env = makeEnv([{ id: 'doc-a', body: 'body a' }]);
    const manifest = planOf(env);
    await runInitial(env, manifest);
    expect(classifyRow(env.sqlite, env.canonical, manifest.rows[0]).state).toBe('COMPLETE'); // clean happy path
    const stored = env.sqlite.prepare("SELECT concepts AS c FROM oracle_documents WHERE id = 'doc-a-rescue'").get() as { c: string };
    const appended = JSON.stringify([...JSON.parse(stored.c), 'tampered-extra']);
    env.sqlite.prepare('UPDATE oracle_documents SET concepts = ? WHERE id = ?').run(appended, 'doc-a-rescue');
    const cls = classifyRow(env.sqlite, env.canonical, manifest.rows[0]);
    expect(cls.state).toBe('INVALID');
    expect(cls.detail).toContain('row/FTS incorrect');
    await expect(runResume(env, manifest)).rejects.toThrow('INVALID');
  });
});

describe('Gate C applier — bundle, containment, and postcondition gates', () => {
  test('P0-1: corrupt bundle denies before any journal/file/DB write', async () => {
    const env = makeEnv([{ id: 'doc-a', body: 'body a' }]);
    const manifest = planOf(env);
    await makeBundle(env);
    // Corrupt one exported byte => owner verifier must fail => apply denies.
    const victim = path.join(env.bundle, 'all-collections.json');
    fs.writeFileSync(victim, `${fs.readFileSync(victim, 'utf8')} `);
    await expect(applyOrphanRescue({
      sqlite: env.sqlite, manifest, mode: 'initial', bundleDir: env.bundle,
      journalPath: env.journalPath, liveGateBPlanSha: manifest.manifestSha256, expectedProtectedCount: 0,
    })).rejects.toThrow('rollback bundle failed owner verification');
    expect(fs.existsSync(env.journalPath)).toBe(false);
    expect(fs.existsSync(path.join(env.canonical, manifest.rows[0].newSourceFile))).toBe(false);
    expect(env.sqlite.prepare("SELECT COUNT(*) AS c FROM oracle_documents WHERE id = 'doc-a-rescue'").get()).toEqual({ c: 0 });
  });

  test('P1-3: resume with a different bundle denies (journal binds bundle realpath + manifest sha)', async () => {
    const env = makeEnv([{ id: 'doc-a', body: 'body a' }]);
    const manifest = planOf(env);
    await runInitial(env, manifest);
    const otherBundle = path.join(env.dir, 'other-bundle');
    const { exportOracleData } = await import('../../../tools/export-app/exporter.ts');
    await exportOracleData({ outputDir: otherBundle, dbPath: env.dbPath, progress: () => {} });
    await expect(applyOrphanRescue({
      sqlite: env.sqlite, manifest, mode: 'resume', bundleDir: otherBundle,
      journalPath: env.journalPath, expectedProtectedCount: 0,
    })).rejects.toThrow('journal header does not bind');
  });

  test('P0-2: parent symlink planted AFTER planning denies with zero outside files', async () => {
    const env = makeEnv([{ id: 'doc-a', body: 'body a' }]);
    const manifest = planOf(env);
    // Plant canonical/github.com -> outside AFTER the plan was accepted.
    const outside = path.join(env.dir, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    fs.symlinkSync(outside, path.join(env.canonical, 'github.com'));
    await expect(runInitial(env, manifest)).rejects.toThrow('escapes canonical root via symlink');
    const escaped = fs.readdirSync(outside, { recursive: true }) as string[];
    expect(escaped.filter(f => f.toString().endsWith('.md'))).toEqual([]);
  });

  test('P1-4: forced postcondition mismatch denies (machine check, not narrative)', async () => {
    const env = makeEnv([{ id: 'doc-a', body: 'body a' }]);
    const manifest = planOf(env);
    await runInitial(env, manifest);
    const before = totalDocuments(env.sqlite);
    env.sqlite.prepare("DELETE FROM oracle_fts WHERE id = 'doc-a-rescue'").run();
    expect(() => runPostconditions({
      sqlite: env.sqlite, canonicalRoot: env.canonical, manifest, totalDocsBefore: before, ingestedThisRun: 0,
    })).toThrow('FTS cardinality/content mismatch');
  });

  test('protected-set count mismatch denies', async () => {
    const env = makeEnv([{ id: 'doc-a', body: 'body a' }]);
    const manifest = planOf(env);
    let denied: InstanceType<typeof RescueApplyDenied> | null = null;
    try { await runInitial(env, manifest, 5); } catch (e) { denied = e as InstanceType<typeof RescueApplyDenied>; }
    expect(denied?.failures.join('|')).toContain('protected set count 0 != expected 5');
  });
});
