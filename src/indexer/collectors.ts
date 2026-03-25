/**
 * Document collectors: scan filesystem and parse markdown into OracleDocuments
 */

import fs from 'fs';
import path from 'path';
import type { OracleDocument, IndexerConfig } from '../types.ts';
import { parseResonanceFile, parseLearningFile, parseRetroFile } from './parser.ts';
import { discoverProjectPsiDirs } from './discovery.ts';

/**
 * Recursively get all markdown files in a directory
 */
export function getAllMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getAllMarkdownFiles(fullPath));
    } else if (item.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Shared options for collecting documents from a source type */
interface CollectOpts {
  config: IndexerConfig;
  seenContentHashes: Set<string>;
  subdir: string;           // e.g. 'resonance', 'learnings', 'retrospectives'
  parseFn: (relPath: string, content: string, sourceOverride?: string) => OracleDocument[];
  label: string;            // e.g. 'resonance', 'learning', 'retrospective'
}

/**
 * Generic collector: scans root source path + project-first vault dirs,
 * deduplicates by content hash, parses files with the given parse function.
 */
export function collectDocuments(opts: CollectOpts): OracleDocument[] {
  const { config, seenContentHashes, subdir, parseFn, label } = opts;
  const documents: OracleDocument[] = [];
  let totalFiles = 0;

  // 1. Root path
  const sourcePath = path.join(config.repoRoot, `\u03c8/memory/${subdir}`);
  if (fs.existsSync(sourcePath)) {
    const files = getAllMarkdownFiles(sourcePath);
    if (files.length === 0) {
      console.log(`Warning: ${sourcePath} exists but contains no .md files`);
    }
    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relPath = path.relative(config.repoRoot, filePath);
      documents.push(...parseFn(relPath, content, relPath));
    }
    totalFiles += files.length;
  }

  // 2. Project-first vault dirs
  let skippedDupes = 0;
  const projectDirs = discoverProjectPsiDirs(config.repoRoot);
  for (const projectDir of projectDirs) {
    const projectSubdir = path.join(projectDir, 'memory', subdir);
    if (!fs.existsSync(projectSubdir)) continue;
    const files = getAllMarkdownFiles(projectSubdir);
    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const contentHash = Bun.hash(content).toString(36);
      if (seenContentHashes.has(contentHash)) { skippedDupes++; continue; }
      seenContentHashes.add(contentHash);
      const relPath = path.relative(config.repoRoot, filePath);
      documents.push(...parseFn(relPath, content, relPath));
    }
    totalFiles += files.length;
  }

  console.log(`Indexed ${documents.length} ${label} documents from ${totalFiles} files (skipped ${skippedDupes} duplicate files)`);
  return documents;
}
