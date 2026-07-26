/**
 * Collector for `ψ/inbox/` (#2855) — Nat's call: *"inbox เป็น knowledge ได้ index ได้เลย."*
 *
 * Lives in its own file rather than in `collectors.ts`, which is at 220 lines and would exceed
 * the 250-line rule with this appended.
 *
 * Walks the local `ψ/inbox/` plus the same project-first vault dirs every other collector
 * walks, so an inbox that arrived through a vault sync is indexed identically to a local one.
 * Deduplication is by content hash against the shared `seenContentHashes` set: the same report
 * is frequently delivered to several oracles and copied between trees, and without this the
 * corpus would carry one row per copy.
 */
import fs from 'fs';
import path from 'path';
import type { IndexerConfig, OracleDocument } from '../types.ts';
import { discoverProjectPsiDirs } from './discovery.ts';
import { getAllMarkdownFiles } from './collectors.ts';
import { isPsiInboxSource, parsePsiInboxFile } from './inbox-doc-source.ts';

export function collectPsiInbox(opts: {
  config: IndexerConfig;
  seenContentHashes: Set<string>;
}): OracleDocument[] {
  const { config, seenContentHashes } = opts;
  const documents: OracleDocument[] = [];
  const subPath = config.sourcePaths.inbox ?? 'ψ/inbox';
  const roots = [
    path.join(config.repoRoot, subPath),
    ...discoverProjectPsiDirs(config.repoRoot).map((psiDir) => path.join(psiDir, 'inbox')),
  ].filter((dir, index, all) => all.indexOf(dir) === index && fs.existsSync(dir));

  let skippedDupes = 0;
  let totalFiles = 0;
  for (const sourcePath of roots) {
    const files = getAllMarkdownFiles(sourcePath);
    totalFiles += files.length;
    for (const filePath of files) {
      const relPath = path.relative(config.repoRoot, filePath).split(path.sep).join('/');
      if (!isPsiInboxSource(relPath)) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content.trim()) continue;
      const contentHash = Bun.hash(content).toString(36);
      if (seenContentHashes.has(contentHash)) { skippedDupes++; continue; }
      seenContentHashes.add(contentHash);
      documents.push(...parsePsiInboxFile(relPath, content));
    }
  }

  console.log(`Indexed ${documents.length} ψ/inbox documents from ${totalFiles} files (skipped ${skippedDupes} duplicates)`);
  return documents;
}
