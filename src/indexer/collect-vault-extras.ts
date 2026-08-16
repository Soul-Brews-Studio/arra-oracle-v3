/**
 * Collector for the vault trees no other collector reaches — design by @Anurak112 (#2800).
 *
 * What was already covered before this: `collectDocuments` walks `{root,project,crew}/memory/
 * {resonance,learnings,retrospectives,distillations}`, `collectPsiLearn` walks `ψ/learn`,
 * `collectPsiInbox` walks `ψ/inbox`, and `collectSecurityCorpus` walks its opt-in corpus.
 * Nothing walked `ψ/outbox` — the outgoing half of exactly the correspondence #2855 decided
 * was knowledge — and nothing walked a crew member's brain outside `memory/`, so
 * `ψ/crew/<member>/CLAUDE.md` (who that member *is*) was unindexed while their learnings
 * were. #2854 landed the `memory/` half of #2800; this is the rest of it.
 *
 * Lives in its own module because `collectors.ts` is 220 lines and the ≤250 rule leaves no
 * room — the same reason `collect-inbox.ts` exists.
 *
 * Not done here, deliberately: project-first vault dirs (`github.com/org/repo/ψ/outbox`).
 * `collectPsiInbox` reaches those for inbox and outbox deserves the same, but that is a
 * separate change with its own dedupe surface, not a quiet rider on this one.
 */

import fs from 'fs';
import path from 'path';
import type { IndexerConfig, OracleDocument } from '../types.ts';
import { crewIndexingDisabled } from './discovery.ts';
import { getAllMarkdownFiles } from './collectors.ts';
import { parseLearningFile } from './parser.ts';

/**
 * Byte budget for one collection pass.
 *
 * The per-file cap matches `SECURITY_CORPUS_MAX_FILE_BYTES` — a single 40MB transcript
 * dumped into `ψ/outbox/` should not become one enormous document. The run cap is the part
 * that matters more: every collected document is held in memory, chunked, and queued for
 * embedding, so an outbox that grows unattended must degrade into "indexed the first 16MB"
 * rather than into an OOM that takes the whole index run — including `ψ/memory/` — with it.
 *
 * Overridable per call so the cap is testable without writing 16MB to disk.
 */
export interface VaultExtraLimits {
  maxFileBytes: number;
  maxTotalBytes: number;
}

export const VAULT_EXTRA_LIMITS: VaultExtraLimits = {
  maxFileBytes: 200 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
};

/** `memory/` is #2854's territory; re-walking it here would only produce dedupe churn. */
const CREW_SUBTREE_ALREADY_INDEXED = 'memory';

function readDirents(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Every crew file outside `memory/`: loose `.md` at the crew root (the roster README),
 * a member's `CLAUDE.md` identity file, and any subtree a member keeps — `learn/`,
 * `inbox/`, `outbox/`, and whatever they invent next. An allow-list of three subdirectory
 * names would silently drop the fourth, which is the defect shape of #2822 / #2846.
 */
function crewFiles(crewRoot: string): string[] {
  const files: string[] = [];
  for (const entry of readDirents(crewRoot)) {
    const memberDir = path.join(crewRoot, entry.name);
    if (!entry.isDirectory()) {
      if (entry.isFile() && entry.name.endsWith('.md')) files.push(memberDir);
      continue;
    }
    for (const sub of readDirents(memberDir)) {
      if (sub.name === CREW_SUBTREE_ALREADY_INDEXED) continue;
      const subPath = path.join(memberDir, sub.name);
      if (sub.isDirectory()) files.push(...getAllMarkdownFiles(subPath));
      else if (sub.isFile() && sub.name.endsWith('.md')) files.push(subPath);
    }
  }
  return files;
}

/** Sorted so a run that hits the byte budget keeps a stable prefix, not a readdir-order one. */
function vaultExtraFiles(repoRoot: string): string[] {
  const psiDir = (...parts: string[]) => path.join(repoRoot, 'ψ', ...parts);
  const files = getAllMarkdownFiles(psiDir('outbox'));
  // Only the crew half answers to ORACLE_INDEX_CREW. ψ/outbox is not a crew tree, and a
  // lever that turns off more than its name says is worse than no lever.
  if (!crewIndexingDisabled()) files.push(...crewFiles(psiDir('crew')));
  return [...new Set(files)].sort();
}

interface BudgetedFiles {
  kept: string[];
  skippedTooLarge: number;
  skippedOverBudget: number;
}

function applyBudget(files: string[], limits: VaultExtraLimits): BudgetedFiles {
  const kept: string[] = [];
  let usedBytes = 0;
  let skippedTooLarge = 0;
  let skippedOverBudget = 0;
  for (const filePath of files) {
    let size: number;
    try {
      size = fs.statSync(filePath).size;
    } catch {
      continue;
    }
    if (size === 0) continue;
    if (size > limits.maxFileBytes) { skippedTooLarge++; continue; }
    if (usedBytes + size > limits.maxTotalBytes) { skippedOverBudget++; continue; }
    usedBytes += size;
    kept.push(filePath);
  }
  return { kept, skippedTooLarge, skippedOverBudget };
}

/**
 * Ids are namespaced by a hash of the full path, matching `psiInboxDocId` / `psiLearnDocId`.
 * `CLAUDE.md` and `README.md` repeat under every crew member, so a basename-derived id would
 * collide and each member's identity file would overwrite the previous one.
 */
function vaultExtraDocId(pathHash: string, id: string): string {
  const suffix = id
    .replace(/^learning_/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');
  return `learning_vault_extra_${pathHash}_${suffix || 'doc'}`;
}

export function parseVaultExtraFile(relativePath: string, content: string): OracleDocument[] {
  const sourceFile = relativePath.split(path.sep).join('/');
  const pathHash = Bun.hash(sourceFile).toString(36);
  // Basename, not the whole path: parseLearningFile derives the title and the fallback id
  // from this argument, and "ψ/crew/omar/CLAUDE.md" is not a title.
  return parseLearningFile(path.basename(sourceFile), content, sourceFile).map((doc) => ({
    ...doc,
    id: vaultExtraDocId(pathHash, doc.id),
    source_file: sourceFile,
  }));
}

export function collectVaultExtraDocuments(opts: {
  config: IndexerConfig;
  seenContentHashes: Set<string>;
  limits?: Partial<VaultExtraLimits>;
}): OracleDocument[] {
  const { config, seenContentHashes } = opts;
  const limits = { ...VAULT_EXTRA_LIMITS, ...opts.limits };
  const budgeted = applyBudget(vaultExtraFiles(config.repoRoot), limits);

  const documents: OracleDocument[] = [];
  let skippedDupes = 0;
  for (const filePath of budgeted.kept) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    if (!content.trim()) continue;
    const contentHash = Bun.hash(content).toString(36);
    if (seenContentHashes.has(contentHash)) { skippedDupes++; continue; }
    seenContentHashes.add(contentHash);
    const relPath = path.relative(config.repoRoot, filePath).split(path.sep).join('/');
    documents.push(...parseVaultExtraFile(relPath, content));
  }

  console.log(
    `Indexed ${documents.length} vault-extra documents from ${budgeted.kept.length} files ` +
    `(skipped ${skippedDupes} duplicates)`
  );
  if (budgeted.skippedTooLarge > 0 || budgeted.skippedOverBudget > 0) {
    console.warn(
      `Vault-extras byte budget hit: skipped ${budgeted.skippedTooLarge} file(s) over ` +
      `${limits.maxFileBytes} bytes and ${budgeted.skippedOverBudget} file(s) past the ` +
      `${limits.maxTotalBytes}-byte run budget`
    );
  }
  return documents;
}
