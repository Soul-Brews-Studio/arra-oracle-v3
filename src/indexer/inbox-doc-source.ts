/**
 * Indexing for `ψ/inbox/` — fleet correspondence treated as knowledge (#2855).
 *
 * `collectDocuments` builds its root as `ψ/memory/${subdir}`, so the only indexed trees were
 * `memory/{resonance,learnings,retrospectives,distillations}` plus `ψ/learn` and the security
 * corpus. **`ψ/inbox/` was never collected by any path.** The ~235 inbox rows already in the
 * corpus are fossils from a single 2026-06-07 batch — measured, not inferred — with no live
 * writer since. Handoffs, reports and cross-oracle messages have accumulated unindexed.
 *
 * These documents reuse type `'learning'` rather than introducing an `'inbox'` type.
 * `OracleDocumentType` is a closed union, and widening it ripples into search filters, export
 * mappings and the UI. `ψ/learn` already set the precedent: it reuses `'learning'` and carries
 * its distinction in `source_file` and an id prefix. Same shape here, so `source_file`
 * beginning `ψ/inbox/` is what identifies these — which is a queryable fact, not a lost one.
 */
import path from 'path';
import type { OracleDocument } from '../types.ts';
import { autoDeriveStructure } from './auto-derive.ts';
import { parseLearningFile } from './parser.ts';

export const PSI_INBOX_REL = path.join('ψ', 'inbox');
const PROJECT_PSI_RE = /^(?:github\.com|gitlab\.com|bitbucket\.org)\/[^/]+\/[^/]+\/(ψ\/.*)$/;

/** Strip a project-first vault prefix so the check works for both local and vault layouts. */
function localPsiPath(sourceFile: string): string {
  const normalized = sourceFile.split(path.sep).join('/');
  return normalized.match(PROJECT_PSI_RE)?.[1] ?? normalized;
}

export function isPsiInboxSource(sourceFile: string): boolean {
  return localPsiPath(sourceFile).startsWith('ψ/inbox/');
}

/**
 * Ids are namespaced by a hash of the full path. Inbox filenames repeat heavily across
 * senders and dates (`2026-07-26_05-56_report-from-arra-oracle-v3.md` has siblings in every
 * oracle's tree), so a basename-derived id would collide and each write would overwrite the
 * previous document rather than adding one.
 */
function psiInboxDocId(pathHash: string, id: string): string {
  const suffix = id
    .replace(/^learning_/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');
  return `learning_psi_inbox_${pathHash}_${suffix || 'doc'}`;
}

export function parsePsiInboxFile(relativePath: string, content: string): OracleDocument[] {
  const sourceFile = relativePath.split(path.sep).join('/');
  const basename = path.basename(sourceFile);
  const pathHash = Bun.hash(sourceFile).toString(36);

  return parseLearningFile(basename, content, sourceFile).map((doc) => {
    const derived = autoDeriveStructure({
      sourceFile,
      content: doc.content,
      project: doc.project,
      existingConcepts: doc.concepts,
    });
    return {
      ...doc,
      id: psiInboxDocId(pathHash, doc.id),
      source_file: sourceFile,
      project: derived.project ?? undefined,
      concepts: derived.concepts,
    };
  });
}
