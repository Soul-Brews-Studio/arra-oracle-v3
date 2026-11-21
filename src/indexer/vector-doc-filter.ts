/**
 * Which documents earn a vector. FTS5 still indexes every document; this only decides what the
 * bulk vector rebuild (`src/scripts/index-model.ts`) spends embedding time on.
 *
 * Measured on m5's oracle.db (530,357 rows, 2026-11-21):
 * - 4,295 rows are under 40 characters: pings, `---`, "yo". Their vectors sit near every short
 *   query and push real hits down. facebook-oracle's brain drops the same band.
 * - `ψ/learn/<owner>/<repo>/origin/` holds copies of other repos' files made by /learn, not notes
 *   written here. One book under `transcriber-oracle/ψ/learn/.../origin/` alone is stored four
 *   ways (FULL_TEXT, TEXT_ONLY and two monthly volumes, about 26k chunks). They stay searchable by
 *   keyword; semantic search covers what the fleet wrote itself.
 */

import type { VectorDocument } from '../vector/types.ts';

export const MIN_VECTOR_CHARS = 40;
const LEARN_ORIGIN = /(^|\/)ψ\/learn\/(.+\/)?origin\//;

export interface VectorDocFilterOptions {
  minChars?: number;
  /** keep documents under ψ/learn/<owner>/<repo>/origin/ (default false) */
  keepLearnOrigin?: boolean;
}

export interface VectorDocFilterResult {
  kept: VectorDocument[];
  tooShort: number;
  learnOrigin: number;
}

export function isLearnOrigin(sourceFile: unknown): boolean {
  return typeof sourceFile === 'string' && LEARN_ORIGIN.test(sourceFile);
}

export function filterVectorDocs(docs: VectorDocument[], opts: VectorDocFilterOptions = {}): VectorDocFilterResult {
  const minChars = opts.minChars ?? MIN_VECTOR_CHARS;
  const kept: VectorDocument[] = [];
  let tooShort = 0;
  let learnOrigin = 0;
  for (const doc of docs) {
    if (!opts.keepLearnOrigin && isLearnOrigin(doc.metadata?.source_file)) learnOrigin += 1;
    else if (doc.document.trim().length < minChars) tooShort += 1;
    else kept.push(doc);
  }
  return { kept, tooShort, learnOrigin };
}
