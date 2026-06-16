/**
 * Document collectors: scan filesystem and parse markdown into OracleDocuments
 */

import fs from 'fs';
import path from 'path';
import type { OracleDocument, IndexerConfig } from '../types.ts';
import { parseResonanceFile, parseLearningFile, parseRetroFile, parseSecurityCorpusFile } from './parser.ts';
import { isPsiLearnSource, parsePsiLearnFile } from './learn-doc-source.ts';
import { discoverProjectPsiDirs } from './discovery.ts';

const SECURITY_CORPUS_EXTENSIONS = ['.md', '.txt', '.yaml', '.yml', '.json', '.rst'];
const SECURITY_CORPUS_MAX_FILE_BYTES = 200 * 1024;  // 200KB cap per file
const SECURITY_CORPUS_SKIP_DIRS = ['_meta', '.git', 'node_modules', '__pycache__'];

/**
 * Recursively get all markdown files in a directory
 */
export function getAllMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
      if (code === 'ENOENT') continue;
      throw err;
    }
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

/**
 * Walk a security-corpus directory, returning files matching SECURITY_CORPUS_EXTENSIONS
 * and under SECURITY_CORPUS_MAX_FILE_BYTES. Skips _meta/, .git/, etc.
 */
function getSecurityCorpusFiles(dir: string): string[] {
  const files: string[] = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    if (SECURITY_CORPUS_SKIP_DIRS.includes(item.name)) continue;
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...getSecurityCorpusFiles(fullPath));
    } else if (item.isFile()) {
      const ext = path.extname(item.name).toLowerCase();
      if (!SECURITY_CORPUS_EXTENSIONS.includes(ext)) continue;
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > SECURITY_CORPUS_MAX_FILE_BYTES) continue;
        if (stat.size === 0) continue;
        files.push(fullPath);
      } catch {
        // Skip unreadable files
      }
    }
  }
  return files;
}

/**
 * Collect repo exploration documents from ψ/learn/.
 * Defaults on so /learn output is part of the standard indexer scan.
 * ψ/learn/security-corpus remains excluded unless collectSecurityCorpus runs.
 */
export function collectPsiLearn(opts: {
  config: IndexerConfig;
  seenContentHashes: Set<string>;
}): OracleDocument[] {
  const { config, seenContentHashes } = opts;
  const documents: OracleDocument[] = [];
  const subPath = config.sourcePaths.learn ?? 'ψ/learn';

  const sourcePath = path.join(config.repoRoot, subPath);
  if (!fs.existsSync(sourcePath)) return documents;

  const files = getAllMarkdownFiles(sourcePath);
  let skippedDupes = 0;
  for (const filePath of files) {
    const relPath = path.relative(config.repoRoot, filePath).split(path.sep).join('/');
    if (!isPsiLearnSource(relPath)) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content.trim()) continue;
    const contentHash = Bun.hash(content).toString(36);
    if (seenContentHashes.has(contentHash)) { skippedDupes++; continue; }
    seenContentHashes.add(contentHash);
    documents.push(...parsePsiLearnFile(relPath, content));
  }

  console.log(`Indexed ${documents.length} ψ/learn documents from ${files.length} files (skipped ${skippedDupes} duplicates)`);
  return documents;
}

export function collectSecurityCorpus(opts: {
  config: IndexerConfig;
  seenContentHashes: Set<string>;
}): OracleDocument[] {
  const { config, seenContentHashes } = opts;
  const documents: OracleDocument[] = [];

  const subPath = config.sourcePaths.security_corpus;
  if (!subPath) return documents;

  const sourcePath = path.join(config.repoRoot, subPath);
  if (!fs.existsSync(sourcePath)) {
    console.log(`Skipping security-corpus: ${sourcePath} not found`);
    return documents;
  }

  const files = getSecurityCorpusFiles(sourcePath);
  let skippedDupes = 0;
  for (const filePath of files) {
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
    const relPath = path.relative(config.repoRoot, filePath);
    documents.push(...parseSecurityCorpusFile(relPath, content));
  }

  console.log(`Indexed ${documents.length} security-corpus documents from ${files.length} files (skipped ${skippedDupes} duplicates)`);
  return documents;
}
