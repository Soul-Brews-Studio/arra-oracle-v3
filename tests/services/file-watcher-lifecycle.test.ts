import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDatabase, oracleDocuments } from '../../src/db/index.ts';
import type { DatabaseConnection } from '../../src/db/create.ts';
import { FileWatcherService } from '../../src/services/file-watcher.ts';

let repoRoot = '';
let connection: DatabaseConnection | undefined;
let service: FileWatcherService | undefined;

function setup(debounceMs = 10): FileWatcherService {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-watcher-life-'));
  connection = createDatabase(path.join(repoRoot, 'oracle.db'));
  service = new FileWatcherService({
    db: connection.sqlite,
    repoRoot,
    debounceMs,
    models: { test: { collection: 'test_collection' } },
    logger: { log: () => {}, warn: () => {} },
  });
  return service;
}

function learnFile(name: string, content = 'watcher lifecycle durable learning') {
  const file = path.join(repoRoot, 'ψ', 'learn', name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

afterEach(() => {
  service?.stop();
  connection?.storage.close();
  if (repoRoot) fs.rmSync(repoRoot, { recursive: true, force: true });
  service = undefined;
  connection = undefined;
  repoRoot = '';
});

describe('FileWatcherService lifecycle and debounce hardening', () => {
  test('restart clears pending debounce timers and resumes watching', () => {
    const watcher = setup(1000);
    const file = learnFile('restart.md');
    watcher.start();
    watcher.schedule(file);

    expect(watcher.status().pending).toBe(1);
    const restarted = watcher.restart();

    expect(restarted.running).toBe(true);
    expect(restarted.pending).toBe(0);
    expect(restarted.events[0].type).toBe('started');
    expect(restarted.events.some((event) => event.type === 'stopped')).toBe(true);
  });

  test('debounces repeated schedules into one indexed document and job', async () => {
    const watcher = setup(5);
    const file = learnFile('debounce.md');
    watcher.start();

    watcher.schedule(file);
    watcher.schedule(file);
    await Bun.sleep(30);

    const status = watcher.status();
    const docs = connection!.db.select().from(oracleDocuments).all()
      .filter((doc) => doc.sourceFile === 'ψ/learn/debounce.md');
    const jobs = connection!.sqlite.query<{ count: number }, []>('select count(*) as count from indexing_jobs').get();

    expect(status.pending).toBe(0);
    expect(status.events.filter((event) => event.type === 'indexed')).toHaveLength(1);
    expect(docs).toHaveLength(1);
    expect(jobs?.count).toBe(1);
  });
});
