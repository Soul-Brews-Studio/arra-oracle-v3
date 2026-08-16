/**
 * Shared contracts for the orphan-rescue lane (Gate B planner + Gate C
 * applier): manifest shape, deterministic hashing, path safety, and the
 * recovery-envelope renderer. Pure helpers only — no DB, no filesystem writes.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const RESCUE_SCHEMA_VERSION = 1;
export const RECOVERY_MARKER = 'arra_recovery: v1';

export interface RescuePlanRow {
  oldId: string;
  oldSourceFile: string;
  type: string;
  project: string;
  concepts: string[];
  createdAt: number;
  updatedAt: number;
  /** sha256 of the exact legacy FTS body embedded in the rendered file. */
  sourceBodySha256: string;
  /** sha256 of enrichTextWithAcronyms(body): what storage will index. */
  expectedIndexedContentSha256: string;
  enrichmentChangesContent: boolean;
  newId: string;
  newSourceFile: string;
  renderedFileSha256: string;
}

export interface RescuePlan {
  schemaVersion: number;
  canonicalRoot: string;
  dbPath: string;
  count: number;
  candidateFingerprint: string;
  rescueSetId: string;
  manifestSha256: string;
  generatedAt: string;
  rows: RescuePlanRow[];
}

export class RescuePlanDenied extends Error {
  readonly failures: string[];
  constructor(failures: string[]) {
    super(`orphan-rescue plan denied: ${failures.length} failure(s); first: ${failures[0]}`);
    this.failures = failures;
  }
}

export class RescueApplyDenied extends Error {
  readonly failures: string[];
  constructor(failures: string[]) {
    super(`orphan-rescue apply denied: ${failures.length} failure(s); first: ${failures[0]}`);
    this.failures = failures;
  }
}

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Stable JSON: objects with sorted keys, so hashing is order-independent. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, function replacer(_key, v) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) sorted[k] = (v as Record<string, unknown>)[k];
      return sorted;
    }
    return v;
  });
}

/** Recompute a manifest's deterministic hash from its own contents. */
export function manifestSha256Of(manifest: RescuePlan): string {
  const { manifestSha256: _sha, generatedAt: _at, ...deterministic } = manifest;
  return sha256(canonicalJson(deterministic));
}

export function realpathOrNull(p: string | null | undefined): string | null {
  if (!p?.trim()) return null;
  try {
    return fs.realpathSync(path.resolve(p.trim()));
  } catch {
    return null;
  }
}

export function isUnsafeRelPath(p: string): boolean {
  if (!p || path.isAbsolute(p)) return true;
  const parts = p.split('/');
  return parts.some(seg => seg === '..' || seg === '') || p.includes('\\');
}

/**
 * The Gate C file contract. Everything the renderer emits is either parser
 * frontmatter the round-trip check proves, or an inert provenance pointer.
 */
export function renderRescueFile(args: {
  newId: string;
  type: string;
  project: string;
  concepts: string[];
  createdAt: number;
  updatedAt: number;
  oldId: string;
  oldSourceFile: string;
  body: string;
}): string {
  const conceptsList = `[${args.concepts.join(', ')}]`;
  return [
    '---',
    `arra_recovery: v1`,
    `arra_id: ${args.newId}`,
    `arra_type: ${args.type}`,
    `arra_concepts: ${conceptsList}`,
    `project: ${args.project}`,
    `arra_created: ${new Date(args.createdAt).toISOString()}`,
    `updated_at: ${new Date(args.updatedAt).toISOString()}`,
    `original_id: ${args.oldId}`,
    `original_source_file: ${args.oldSourceFile}`,
    '---',
    '',
    args.body,
    '',
  ].join('\n');
}
