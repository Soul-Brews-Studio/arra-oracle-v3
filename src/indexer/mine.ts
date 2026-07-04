import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { createDatabase, oracleDocuments, oracleFts, type DatabaseConnection } from '../db/index.ts';
import { detectProject } from '../server/project-detect.ts';
import type { OracleDocument } from '../types.ts';
import { deriveConceptsFromPath, extractConcepts, mergeConceptsWithTags } from './concepts.ts';
import { chunkDocumentForIndexing } from './chunk-text.ts';
import { storeDocuments } from './storage.ts';

const DEFAULT_EXTENSIONS = new Set(['.md', '.mdx', '.txt']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.turbo']);
const MAX_MINE_FILE_BYTES = 2 * 1024 * 1024;
const BINARY_SAMPLE_BYTES = 4096;

export interface MineOptions { dir: string; dbPath?: string; dryRun?: boolean }
export interface MineResult { scanned: number; stored: number; skipped: number; project: string; root: string }
export interface MineWatchOptions extends MineOptions { signal?: AbortSignal; debounceMs?: number }

interface ExistingMineRow { id: string; updatedAt: number }
type OracleDb = DatabaseConnection['db'];

export function stableMineDocId(root: string, filePath: string): string {
  const rel = relativeSource(root, filePath);
  return `mine_${createHash('sha256').update(rel).digest('hex').slice(0, 24)}`;
}

export function contentVersion(content: string): number {
  return parseInt(createHash('sha256').update(content).digest('hex').slice(0, 12), 16);
}

export function collectMineFiles(root: string): string[] {
  const files: string[] = [];
  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.notes') continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && DEFAULT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(full);
    }
  }
  walk(root);
  return files.sort();
}

export async function mineFolder(options: MineOptions): Promise<MineResult> {
  const root = path.resolve(options.dir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`mine target must be a directory: ${options.dir}`);
  }
  const files = collectMineFiles(root);
  const project = detectProject(root) || path.basename(root).toLowerCase();
  const { sqlite, db, storage } = createDatabase(options.dbPath);
  try {
    const docs: OracleDocument[] = [];
    let skipped = 0;
    for (const file of files) {
      const source = relativeSource(root, file);
      const existing = existingMineRows(db, source);
      const content = readMineContent(file);
      if (!content) {
        skipped++;
        if (!options.dryRun) deleteStaleMineRows(db, existing, new Set());
        continue;
      }
      const updatedAt = contentVersion(content);
      const nextDocs = chunkDocumentForIndexing(toMineDocument(root, file, content, updatedAt, project));
      const keepIds = new Set(nextDocs.map((doc) => doc.id));
      if (!options.dryRun) deleteStaleMineRows(db, existing, keepIds);
      const existingVersions = new Map(existing.map((row) => [row.id, row.updatedAt]));
      const changedDocs = nextDocs.filter((doc) => existingVersions.get(doc.id) !== updatedAt);
      if (changedDocs.length === 0) skipped++;
      docs.push(...changedDocs);
    }
    if (!options.dryRun && docs.length > 0) {
      await storeDocuments(sqlite, db, null, project, docs, { createdBy: 'mine' });
    }
    return { scanned: files.length, stored: docs.length, skipped, project, root };
  } finally {
    storage.close();
  }
}

export async function watchMineFolder(
  options: MineWatchOptions,
  onResult: (result: MineResult) => void = () => {},
): Promise<void> {
  const root = path.resolve(options.dir);
  const signal = options.signal;
  const debounceMs = options.debounceMs ?? 300;
  const watchers: fs.FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = Promise.resolve();

  const run = () => {
    running = running.then(async () => onResult(await mineFolder(options)));
    return running;
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void run(); }, debounceMs);
  };
  const close = () => {
    if (timer) clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };

  for (const dir of collectMineDirs(root)) watchers.push(fs.watch(dir, schedule));
  await run();
  if (signal?.aborted) return close();
  await new Promise<void>((resolve) => {
    signal?.addEventListener('abort', () => { close(); resolve(); }, { once: true });
  });
  await running;
}

function collectMineDirs(root: string): string[] {
  const dirs = [root];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    dirs.push(...collectMineDirs(path.join(root, entry.name)));
  }
  return dirs;
}

function readMineContent(file: string): string | null {
  const stat = fs.statSync(file);
  if (stat.size === 0 || stat.size > MAX_MINE_FILE_BYTES) return null;
  const buffer = fs.readFileSync(file);
  if (isLikelyBinary(buffer)) return null;
  const content = buffer.toString('utf8').trim();
  return content || null;
}

function isLikelyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, BINARY_SAMPLE_BYTES));
  if (sample.length === 0) return false;
  let control = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 13 && byte < 32)) control++;
  }
  return control / sample.length > 0.3;
}

function existingMineRows(db: OracleDb, source: string): ExistingMineRow[] {
  return db.select({ id: oracleDocuments.id, updatedAt: oracleDocuments.updatedAt })
    .from(oracleDocuments)
    .where(and(eq(oracleDocuments.sourceFile, source), eq(oracleDocuments.createdBy, 'mine')))
    .all();
}

function deleteStaleMineRows(db: OracleDb, rows: ExistingMineRow[], keep: Set<string>): void {
  const stale = rows.filter((row) => !keep.has(row.id));
  if (stale.length === 0) return;
  const ids = stale.map((row) => row.id);
  db.transaction((tx) => {
    tx.delete(oracleDocuments)
      .where(and(inArray(oracleDocuments.id, ids), eq(oracleDocuments.createdBy, 'mine')))
      .run();
    tx.delete(oracleFts).where(inArray(oracleFts.id, ids)).run();
  });
}

function toMineDocument(root: string, file: string, content: string, version: number, project: string): OracleDocument {
  const source = relativeSource(root, file);
  const title = path.basename(file, path.extname(file));
  const concepts = mergeConceptsWithTags(
    extractConcepts(title, content),
    [project, ...deriveConceptsFromPath(source)],
  );
  return {
    id: stableMineDocId(root, file), type: 'learning', source_file: source, content,
    concepts, created_at: fs.statSync(file).birthtimeMs || version,
    updated_at: version, project,
  };
}

function relativeSource(root: string, filePath: string): string {
  return `mine/${path.basename(root)}/${path.relative(root, filePath).split(path.sep).join('/')}`;
}
