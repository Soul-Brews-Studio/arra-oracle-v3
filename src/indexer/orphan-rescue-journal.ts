/**
 * Gate C journal: an advisory, append-only trace whose header fully binds the
 * run — manifest sha, verified rollback bundle (realpath + its manifest.json
 * sha), canonical root, the CONNECTED database realpath (from PRAGMA, not the
 * caller's string), tenant, and the frozen protected set (count + ids + ids
 * hash + digest). Resume refuses any journal that does not bind exactly.
 */

import fs from 'fs';
import path from 'path';
import type { Database } from 'bun:sqlite';
import { DEFAULT_TENANT_ID } from '../middleware/tenant.ts';
import { realpathOrNull, sha256, RescueApplyDenied } from './orphan-rescue-shared.ts';
import type { ProtectedSet } from './orphan-rescue-classify.ts';

export interface JournalHeader {
  kind: 'orphan-rescue-journal';
  manifestSha256: string;
  bundleRealpath: string;
  bundleManifestSha256: string;
  canonicalRoot: string;
  dbRealpath: string;
  tenantId: string;
  protectedCount: number;
  protectedIds: string[];
  protectedIdsSha256: string;
  protectedDigest: string;
  createdAt: string;
}

export interface JournalBinding {
  manifestSha256: string;
  bundleRealpath: string;
  bundleManifestSha256: string;
  canonicalRoot: string;
  dbRealpath: string;
  protectedSet: ProtectedSet;
}

/** The realpath of the database this connection is actually attached to. */
export function connectedDbRealpath(sqlite: Database): string {
  const dbList = sqlite.prepare('PRAGMA database_list').all() as Array<{ name: string; file: string | null }>;
  const mainFile = dbList.find(d => d.name === 'main')?.file ?? '';
  if (!mainFile) throw new RescueApplyDenied(['connected database has no file path (in-memory DB cannot be a live rescue target)']);
  return realpathOrNull(mainFile) ?? path.resolve(mainFile);
}

export function buildJournalHeader(binding: JournalBinding, now: () => Date): JournalHeader {
  return {
    kind: 'orphan-rescue-journal',
    manifestSha256: binding.manifestSha256,
    bundleRealpath: binding.bundleRealpath,
    bundleManifestSha256: binding.bundleManifestSha256,
    canonicalRoot: binding.canonicalRoot,
    dbRealpath: binding.dbRealpath,
    tenantId: DEFAULT_TENANT_ID,
    protectedCount: binding.protectedSet.ids.length,
    protectedIds: binding.protectedSet.ids,
    protectedIdsSha256: binding.protectedSet.idsSha256,
    protectedDigest: binding.protectedSet.digest,
    createdAt: now().toISOString(),
  };
}

export function verifyJournalHeader(journalPath: string, binding: JournalBinding): JournalHeader {
  if (!fs.existsSync(journalPath)) {
    throw new RescueApplyDenied([`resume mode requires an existing journal: ${journalPath}`]);
  }
  const headerLine = fs.readFileSync(journalPath, 'utf8').split('\n')[0] ?? '';
  let header: JournalHeader;
  try { header = JSON.parse(headerLine); } catch { throw new RescueApplyDenied(['journal header unreadable']); }

  const mismatches: string[] = [];
  if (header.kind !== 'orphan-rescue-journal') mismatches.push('kind');
  if (header.manifestSha256 !== binding.manifestSha256) mismatches.push('manifestSha256');
  if (header.bundleRealpath !== binding.bundleRealpath) mismatches.push('bundleRealpath');
  if (header.bundleManifestSha256 !== binding.bundleManifestSha256) mismatches.push('bundleManifestSha256');
  if (header.canonicalRoot !== binding.canonicalRoot) mismatches.push('canonicalRoot');
  if (header.dbRealpath !== binding.dbRealpath) mismatches.push('dbRealpath');
  if (header.tenantId !== DEFAULT_TENANT_ID) mismatches.push('tenantId');
  if (mismatches.length) {
    throw new RescueApplyDenied([`journal header does not bind to this run: ${mismatches.join(', ')}`]);
  }
  if (header.protectedCount !== binding.protectedSet.ids.length
    || header.protectedIdsSha256 !== binding.protectedSet.idsSha256
    || sha256(JSON.stringify(header.protectedIds)) !== sha256(JSON.stringify(binding.protectedSet.ids))) {
    throw new RescueApplyDenied(['protected ID set changed since initial run']);
  }
  if (header.protectedDigest !== binding.protectedSet.digest) {
    throw new RescueApplyDenied(['protected set digest changed since initial run']);
  }
  return header;
}

export function appendJournal(fd: number, event: Record<string, unknown>): void {
  fs.writeSync(fd, `${JSON.stringify(event)}\n`);
  fs.fsyncSync(fd);
}
