/**
 * Document collectors: scan filesystem and parse markdown into OracleDocuments
 */

import fs from 'fs';
import path from 'path';
import type { OracleDocument, IndexerConfig } from '../types.ts';
import { parseResonanceFile, parseLearningFile, parseRetroFile, parseSecurityCorpusFile, parseKnowledgeCorpusFile } from './parser.ts';
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
 * Collect security-corpus documents from ψ/learn/security-corpus/.
 * OPT-IN: only runs when config.sourcePaths.security_corpus is set.
 * Reference: ψ/memory/learnings/2026-04-26_arra-v3-indexer-extension.md
 */
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

// --- Knowledge / book corpus (reference books → RAG) ---
// Mirrors the security-corpus flow but for ψ/knowledge/book-corpus/.
// Higher file cap (books are larger than security snippets); .md/.txt only.
const KNOWLEDGE_CORPUS_EXTENSIONS = ['.md', '.txt'];
const KNOWLEDGE_CORPUS_MAX_FILE_BYTES = 5 * 1024 * 1024;  // 5MB cap per file (a whole book's extracted text)
const KNOWLEDGE_CORPUS_SKIP_DIRS = ['_meta', '.git', 'node_modules', '__pycache__'];

/**
 * Walk a knowledge-corpus directory, returning files matching KNOWLEDGE_CORPUS_EXTENSIONS
 * and under KNOWLEDGE_CORPUS_MAX_FILE_BYTES. Skips _meta/, .git/, etc.
 */
function getKnowledgeCorpusFiles(dir: string): string[] {
  const files: string[] = [];
  let items: fs.Dirent[];
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;  // unreadable dir → skip (fail-safe), don't crash the reindex (suho #3)
  }
  for (const item of items) {
    if (KNOWLEDGE_CORPUS_SKIP_DIRS.includes(item.name)) continue;
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...getKnowledgeCorpusFiles(fullPath));
    } else if (item.isFile()) {
      const ext = path.extname(item.name).toLowerCase();
      if (!KNOWLEDGE_CORPUS_EXTENSIONS.includes(ext)) continue;
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > KNOWLEDGE_CORPUS_MAX_FILE_BYTES) continue;
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
 * Collect knowledge/book-corpus documents from ψ/knowledge/book-corpus/.
 * OPT-IN: only runs when config.sourcePaths.knowledge_corpus is set
 * (ORACLE_INDEX_KNOWLEDGE_CORPUS=1). Reference books distilled into markdown → RAG.
 */
export function collectKnowledgeCorpus(opts: {
  config: IndexerConfig;
  seenContentHashes: Set<string>;
}): OracleDocument[] {
  const { config, seenContentHashes } = opts;
  const documents: OracleDocument[] = [];

  const subPath = config.sourcePaths.knowledge_corpus;
  if (!subPath) return documents;

  const sourcePath = path.join(config.repoRoot, subPath);
  if (!fs.existsSync(sourcePath)) {
    console.log(`Skipping knowledge-corpus: ${sourcePath} not found`);
    return documents;
  }

  const files = getKnowledgeCorpusFiles(sourcePath);
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
    documents.push(...parseKnowledgeCorpusFile(relPath, content));
  }

  console.log(`Indexed ${documents.length} knowledge-corpus documents from ${files.length} files (skipped ${skippedDupes} duplicates)`);
  return documents;
}

// --- Fleet machine lanes (study-notes, auto-observations, auto-graph) ---
// Always-on when paths exist under ORACLE_REPO_ROOT. Same memory corpus as learnings.
const MACHINE_LANE_SKIP = new Set(['INDEX.md', '_TEMPLATE.md', '.gitkeep']);
const MACHINE_LANE_DIRS = [
  'ψ/knowledge/study-notes',
  'ψ/auto-observations',
  'ψ/auto-graph',
];

/**
 * Collect fleet machine-lane markdown into the memory corpus (type: learning).
 * Reference: oracle-home/scripts/fleet/indexer-paths-manifest.json (P0-R6)
 */
export function collectMachineLanes(opts: {
  config: IndexerConfig;
  seenContentHashes: Set<string>;
}): OracleDocument[] {
  const { config, seenContentHashes } = opts;
  const documents: OracleDocument[] = [];
  let totalFiles = 0;
  let skippedDupes = 0;

  for (const subPath of MACHINE_LANE_DIRS) {
    const sourcePath = path.join(config.repoRoot, subPath);
    if (!fs.existsSync(sourcePath)) {
      console.log(`Skipping machine-lane: ${sourcePath} not found`);
      continue;
    }
    const files = getAllMarkdownFiles(sourcePath).filter(f => !MACHINE_LANE_SKIP.has(path.basename(f)));
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
      const relSlug = relPath.replace(/\//g, '_').replace(/\.md$/i, '');
      const parsed = parseLearningFile(path.basename(filePath), content, relPath);
      parsed.forEach((doc, index) => {
        doc.id = parsed.length === 1 ? `learning_${relSlug}_0` : `learning_${relSlug}_${index}`;
        doc.content = `${relPath}\n${doc.content}`;
        documents.push(doc);
      });
    }
    totalFiles += files.length;
  }

  console.log(`Indexed ${documents.length} machine-lane documents from ${totalFiles} files (skipped ${skippedDupes} duplicates)`);
  return documents;
}
