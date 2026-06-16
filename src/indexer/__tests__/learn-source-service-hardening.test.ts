import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FileWatcherService } from '../../services/file-watcher.ts';
import { isPsiLearnSource, parsePsiLearnFile } from '../learn-doc-source.ts';

const DOC_SCHEMA = `
CREATE TABLE oracle_documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  source_file TEXT NOT NULL,
  concepts TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL,
  superseded_by TEXT,
  superseded_at INTEGER,
  superseded_reason TEXT,
  origin TEXT,
  project TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_by TEXT
);
CREATE VIRTUAL TABLE oracle_fts USING fts5(id UNINDEXED, content, concepts, tokenize='porter unicode61');`;

const MODELS = { 'bge-m3': { collection: 'oracle_knowledge_bge_m3' } };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 1_500) {
    if (check()) return;
    await wait(25);
  }
  throw new Error('timed out waiting for hardening condition');
}

describe('ψ/learn source hardening', () => {
  test('namespaces caller-supplied frontmatter ids by source path', () => {
    const content = '---\nid: shared-id\nconcepts: [edge]\n---\n# Shared\n\nBody';
    const left = parsePsiLearnFile('ψ/learn/github.com/acme/left/shared.md', content)[0];
    const right = parsePsiLearnFile('ψ/learn/github.com/acme/right/shared.md', content)[0];

    expect(left.id).toStartWith('learning_psi_learn_');
    expect(right.id).toStartWith('learning_psi_learn_');
    expect(left.id).not.toBe(right.id);
    expect(left.id).toEndWith('_shared-id');
  });

  test('sanitizes unsafe caller-supplied id fragments', () => {
    const doc = parsePsiLearnFile('ψ/learn/a.md', '---\nid: ../bad id/\n---\nBody')[0];

    expect(doc.id).toStartWith('learning_psi_learn_');
    expect(doc.id).not.toContain('/');
    expect(doc.id).not.toContain(' ');
    expect(doc.id).not.toContain('..');
  });

  test('excludes security corpus paths after project-prefix normalization', () => {
    expect(isPsiLearnSource('github.com/acme/repo/ψ/learn/security-corpus/secret.md')).toBe(false);
    expect(isPsiLearnSource('github.com/acme/repo/ψ/learn/notes/public.md')).toBe(true);
  });
});

describe('FileWatcherService enqueue hardening', () => {
  let repoRoot = '';
  let db: Database;
  let service: FileWatcherService;
  let logs: string[];

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-watcher-hardening-'));
    db = new Database(':memory:');
    db.exec(DOC_SCHEMA);
    logs = [];
    service = new FileWatcherService({
      db,
      repoRoot,
      models: MODELS,
      debounceMs: 5,
      logger: { log: (msg) => logs.push(String(msg)), warn: (msg) => logs.push(String(msg)) },
    });
  });

  afterEach(() => {
    service.stop();
    db.close();
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  test('keeps SQLite and FTS indexing when vector job tables are unavailable', async () => {
    const filePath = path.join(repoRoot, 'ψ', 'learn', 'github.com', 'acme', 'repo', 'watch.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '# Watch\n\n## Finding\n\nSQLite indexing should survive queue failures.', 'utf8');

    service.start();
    service.schedule(filePath);
    await waitFor(() => count('oracle_documents') === 1);

    const status = service.status();
    expect(count('oracle_fts')).toBe(1);
    expect(status.events[0]).toMatchObject({ type: 'indexed', docs: 1, jobs: 0 });
    expect(status.events.some((event) => event.type === 'error' && event.message.includes('failed to enqueue vector jobs'))).toBe(true);
    expect(logs.some((line) => line.includes('failed to enqueue vector jobs'))).toBe(true);
  });

  function count(table: string): number {
    return db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0;
  }
});
