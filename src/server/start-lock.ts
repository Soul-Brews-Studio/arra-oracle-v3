/**
 * File lock guarding server auto-start.
 *
 * Extracted from `src/ensure-server.ts` (#2833): that file was 258 lines against the 250-line
 * rule, and process locking is a separable concern from server lifecycle — the lock answers
 * "is another process already trying to start one?", which is true regardless of what starting
 * involves.
 *
 * The staleness handling is the part worth keeping intact. A lock file left behind by a crashed
 * process would otherwise block auto-start forever, so a lock is released when it is either too
 * old OR held by a PID that is no longer alive. Both conditions matter: a live process can hold
 * a lock longer than the timeout during a slow start, and a dead one can leave a fresh lock.
 */
import path from 'path';
import fs from 'fs';
import { getDataDir, isProcessAlive, readPidFile, removePidFile } from '../process-manager/index.ts';

/** Maximum age before a lock is presumed abandoned. */
export const LOCK_TIMEOUT_MS = 30_000;

export function lockFilePath(): string {
  return path.join(getDataDir(), 'oracle-http.lock');
}

/**
 * Take the start lock, or report that someone else holds it.
 *
 * Written with the `wx` flag so creation is atomic — two processes racing here cannot both
 * believe they won.
 */
export function acquireStartLock(): boolean {
  const lockFile = lockFilePath();
  try {
    if (fs.existsSync(lockFile)) {
      const content = fs.readFileSync(lockFile, 'utf-8').trim();
      const lockPid = parseInt(content, 10);
      const age = Date.now() - fs.statSync(lockFile).mtimeMs;

      const isStale = age > LOCK_TIMEOUT_MS;
      const isOrphan = !Number.isNaN(lockPid) && !isProcessAlive(lockPid);

      if (isStale || isOrphan) fs.unlinkSync(lockFile);
      else return false;
    }
    fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    // Lost the race, or the data dir is not writable. Either way we do not hold it.
    return false;
  }
}

export function releaseStartLock(): void {
  try {
    const lockFile = lockFilePath();
    if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
  } catch {
    // Best effort: a lock we cannot remove ages out via LOCK_TIMEOUT_MS.
  }
}

/** Remove a PID file whose process is gone, so it does not look like a running server. */
export function cleanupStalePidFile(verbose = false): void {
  const pidInfo = readPidFile();
  if (pidInfo && !isProcessAlive(pidInfo.pid)) {
    if (verbose) console.log(`🧹 Cleaning stale PID file (PID ${pidInfo.pid} is dead)`);
    removePidFile();
  }
}
