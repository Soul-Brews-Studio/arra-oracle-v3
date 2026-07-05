import { afterAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { mineFolder } from '../../../src/indexer/mine.ts';

const root = mkdtempSync(join(tmpdir(), 'arra-mine-onboarding-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

type RunResult = { exitCode: number; stdout: string; stderr: string };

async function run(command: string[], env: Record<string, string | undefined>): Promise<RunResult> {
  const proc = Bun.spawn(command, { cwd: process.cwd(), env, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

function rows(dbPath: string): Array<Record<string, any>> {
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    return sqlite.prepare(`
      SELECT d.id, d.source_file, d.project, d.concepts, d.created_by, f.content
      FROM oracle_documents d
      JOIN oracle_fts f ON f.id = d.id
      WHERE d.created_by = 'mine'
      ORDER BY d.source_file
    `).all() as Array<Record<string, any>>;
  } finally {
    sqlite.close();
  }
}

describe('P0 onboarding mine CLI', () => {
  test('ingests a markdown folder through the shipped CLI', async () => {
    const notes = join(root, `notes-${Date.now()}`);
    const dbPath = join(root, 'mine-cli.db');
    mkdirSync(join(notes, 'ops'), { recursive: true });
    writeFileSync(join(notes, 'ops', 'deploy.md'), '# Deploy Runbook\n\nRollback checklist and deploy memory notes.');
    writeFileSync(join(notes, 'ops', 'ignore.json'), '{"skip":true}');

    const result = await run([process.execPath, 'bin/arra.ts', 'mine', notes, '--db-path', dbPath], {
      ...process.env,
      ORACLE_DATA_DIR: join(root, 'data-cli'),
      ORACLE_EMBEDDER: 'none',
      ORACLE_VECTOR_DISABLED: '1',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Mined 1 document from 1 file');
    const stored = rows(dbPath);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ created_by: 'mine', source_file: `mine/${basename(notes)}/ops/deploy.md` });
    expect(stored[0].content).toContain('Rollback checklist');
    expect(JSON.parse(stored[0].concepts)).toEqual(expect.arrayContaining(['deploy', 'memory', 'ops']));
  }, 30_000);

  test('auto-derives project and concepts from the mined directory structure', async () => {
    const repo = join(root, 'github.com', 'Soul-Brews-Studio', 'onboarding-demo');
    const docs = join(repo, 'knowledge');
    const dbPath = join(root, 'mine-derive.db');
    mkdirSync(join(docs, 'architecture'), { recursive: true });
    writeFileSync(join(docs, 'architecture', 'vector-search.md'), '# Vector Search\n\nRetrieval ranking and onboarding config notes.');

    const result = await mineFolder({ dir: docs, dbPath });
    const [stored] = rows(dbPath);

    expect(result).toMatchObject({ scanned: 1, stored: 1, skipped: 0, project: 'github.com/soul-brews-studio/onboarding-demo' });
    expect(stored.project).toBe('github.com/soul-brews-studio/onboarding-demo');
    expect(JSON.parse(stored.concepts)).toEqual(expect.arrayContaining([
      'github.com/soul-brews-studio/onboarding-demo',
      'architecture',
      'vector',
      'search',
      'ranking',
      'config',
    ]));
  });
});
