/**
 * Tests for backup file-lock to prevent race conditions
 * when concurrent reindex processes run close together.
 *
 * @see https://github.com/Soul-Brews-Studio/arra-oracle-v3/issues/1037
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { acquireLock, releaseLock } from '../backup.ts';

describe('backup file lock', () => {
  let tmpDir: string;
  let lockPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-backup-test-'));
    lockPath = path.join(tmpDir, 'test.db.backup.lock');
  });

  afterEach(() => {
    // Clean up
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* best effort */ }
  });

  it('acquires lock when no lock exists', () => {
    expect(acquireLock(lockPath)).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(true);
    releaseLock(lockPath);
  });

  it('fails to acquire when lock already held', () => {
    expect(acquireLock(lockPath)).toBe(true);
    expect(acquireLock(lockPath)).toBe(false);
    releaseLock(lockPath);
  });

  it('allows re-acquire after release', () => {
    expect(acquireLock(lockPath)).toBe(true);
    releaseLock(lockPath);
    expect(acquireLock(lockPath)).toBe(true);
    releaseLock(lockPath);
  });

  it('writes PID to lock file', () => {
    acquireLock(lockPath);
    const content = fs.readFileSync(lockPath, 'utf-8').trim();
    expect(content).toBe(String(process.pid));
    releaseLock(lockPath);
  });

  it('reclaims stale lock (mtime > threshold)', () => {
    // Create a lock file and back-date it
    fs.writeFileSync(lockPath, '99999\n');
    const staleTime = Date.now() - 6 * 60 * 1000; // 6 minutes ago
    fs.utimesSync(lockPath, new Date(staleTime), new Date(staleTime));

    // Should reclaim the stale lock
    expect(acquireLock(lockPath)).toBe(true);
    const content = fs.readFileSync(lockPath, 'utf-8').trim();
    expect(content).toBe(String(process.pid));
    releaseLock(lockPath);
  });

  it('does not reclaim fresh lock from another process', () => {
    // Create a lock file with a recent mtime (simulating another live process)
    fs.writeFileSync(lockPath, '99999\n');
    // mtime is "now" by default — well within the 5-minute threshold

    expect(acquireLock(lockPath)).toBe(false);
    // Clean up manually since we didn't acquire
    fs.unlinkSync(lockPath);
  });

  it('releaseLock is safe when lock already removed', () => {
    // Should not throw
    expect(() => releaseLock(lockPath)).not.toThrow();
  });
});
