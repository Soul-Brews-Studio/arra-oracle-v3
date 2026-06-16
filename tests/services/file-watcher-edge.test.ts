import { afterEach, describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FileWatcherService } from '../../src/services/file-watcher.ts';

let repoRoot = '';
let db: Database | undefined;
let service: FileWatcherService | undefined;

function createService() {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-watcher-edge-'));
  db = new Database(':memory:');
  service = new FileWatcherService({
    db,
    repoRoot,
    models: {},
    debounceMs: 10,
    logger: { log: () => {}, warn: () => {} },
  });
  return service;
}

afterEach(() => {
  service?.stop();
  db?.close();
  if (repoRoot) fs.rmSync(repoRoot, { recursive: true, force: true });
  service = undefined;
  db = undefined;
  repoRoot = '';
});

describe('FileWatcherService edge cases', () => {
  test('status snapshots cannot mutate internal event history', () => {
    const watcher = createService();
    watcher.start();
    const snapshot = watcher.status();
    snapshot.events[0].message = 'mutated externally';
    snapshot.events.push({ type: 'error', at: 'now', message: 'injected' });

    const fresh = watcher.status();
    expect(fresh.events).toHaveLength(1);
    expect(fresh.events[0].message).not.toBe('mutated externally');
  });

  test('manual schedule ignores blank and non-string paths without throwing', () => {
    const watcher = createService();
    watcher.start();

    expect(() => watcher.schedule('   ')).not.toThrow();
    expect(() => watcher.schedule(null as never)).not.toThrow();
    expect(watcher.status().pending).toBe(0);
  });
});
