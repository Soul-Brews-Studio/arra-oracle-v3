/**
 * Auto-index canonical Oracle project documents under `ψ/projects/`.
 *
 * Canonical project watcher:
 * - new Markdown files are stored into SQLite/FTS and queued for vector work;
 * - edits replace current content and supersede stale chunk ids;
 * - deleted Markdown sources remove their derived index projection and queue
 *   vector cleanup;
 * - invalid project ids, non-Markdown files, and paths outside the canonical
 *   projects root fail closed.
 */
import fs from 'fs';
import path from 'path';
import type Database from 'bun:sqlite';
import { and, count, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.ts';
import { REPO_ROOT } from '../config.ts';
import { enqueueIndexJob } from './jobs.ts';
import {
  PSI_PROJECTS_REL,
  isPsiProjectsSource,
  parsePsiProjectFile,
} from './project-doc-source.ts';
import { storeSqliteDocuments } from './learn-doc-source.ts';
import { chunkDocumentsForIndexing } from './chunker.ts';
import { supersedeReplacedSourceDocs } from './reindex-state.ts';
import {
  isWithinRoot,
  listDirs,
  listFiles,
  safeClearTimeout,
  safeClose,
  watchDir,
} from './watch-utils.ts';
import { currentTenantId } from '../middleware/tenant.ts';
import { removeDocumentPointers } from '../search/pointer-index.ts';

const { indexingJobs, oracleDocuments } = schema;
type WatcherDb = BunSQLiteDatabase<typeof schema>;

export interface ProjectWatcherOptions {
  db: Database;
  models: Record<string, { collection: string }>;
  repoRoot?: string;
  debounceMs?: number;
}

export type StopProjectWatch = () => void;
const DEFAULT_DEBOUNCE_MS = 250;

function isMarkdownFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.md';
}

function normalizeSourceFile(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function hasActiveJobs(db: WatcherDb, docId: string): boolean {
  const row = db.select({ count: count(indexingJobs.id) })
    .from(indexingJobs)
    .where(and(eq(indexingJobs.docId, docId), inArray(indexingJobs.status, ['pending', 'claimed'])))
    .get();
  return (row?.count ?? 0) > 0;
}

function enqueueDocIds(
  sqlite: Database,
  db: WatcherDb,
  models: Record<string, { collection: string }>,
  ids: string[],
): number {
  let queued = 0;
  for (const id of ids) {
    if (hasActiveJobs(db, id)) continue;
    try { queued += enqueueIndexJob(sqlite, { docId: id, models }).length; }
    catch { continue; }
  }
  return queued;
}

function activeProjectIds(db: WatcherDb, sourceFile: string): string[] {
  const tenantId = currentTenantId();
  const filters: SQL[] = [
    eq(oracleDocuments.sourceFile, sourceFile),
    eq(oracleDocuments.type, 'learning'),
    isNull(oracleDocuments.supersededAt),
  ];
  if (tenantId) filters.push(eq(oracleDocuments.tenantId, tenantId));
  return db.select({ id: oracleDocuments.id })
    .from(oracleDocuments)
    .where(and(...filters))
    .all()
    .map((row) => row.id);
}

function activeProjectSources(db: WatcherDb): string[] {
  const tenantId = currentTenantId();
  const filters: SQL[] = [
    eq(oracleDocuments.type, 'learning'),
    isNull(oracleDocuments.supersededAt),
  ];
  if (tenantId) filters.push(eq(oracleDocuments.tenantId, tenantId));

  return [
    ...new Set(
      db.select({ sourceFile: oracleDocuments.sourceFile })
        .from(oracleDocuments)
        .where(and(...filters))
        .all()
        .map((row) => row.sourceFile)
        .filter(isPsiProjectsSource)
    ),
  ];
}

function cleanupMissingProjectSource(
  sqlite: Database,
  db: WatcherDb,
  models: Record<string, { collection: string }>,
  sourceFile: string,
): number {
  const ids = activeProjectIds(db, sourceFile);
  if (ids.length === 0) return 0;

  const tenantId = currentTenantId();

  // Projection removal and cleanup-job creation are atomic. Cleanup jobs are
  // deliberately NOT deduplicated against pending/claimed indexing jobs:
  // a later cleanup job must remain behind any in-flight stale upsert.
  const cleanup = sqlite.transaction(() => {
    for (const id of ids) {
      sqlite.query('DELETE FROM oracle_documents WHERE id = ?').run(id);
      sqlite.query('DELETE FROM oracle_fts WHERE id = ?').run(id);
    }

    removeDocumentPointers(sqlite, tenantId, ids);

    let queued = 0;
    for (const id of ids) {
      queued += enqueueIndexJob(sqlite, { docId: id, models }).length;
    }
    return queued;
  });

  return cleanup();
}

export function startProjectWatcher({
  db: sqlite,
  models,
  repoRoot = REPO_ROOT,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: ProjectWatcherOptions): StopProjectWatch {
  const db = drizzle(sqlite, { schema });
  const root = path.resolve(repoRoot);
  const projectsRoot = path.join(root, PSI_PROJECTS_REL);

  let realRoot: string;
  let realProjectsRoot: string;
  try {
    fs.mkdirSync(projectsRoot, { recursive: true });
    realRoot = fs.realpathSync(root);
    realProjectsRoot = fs.realpathSync(projectsRoot);
  } catch {
    return () => {};
  }

  // The canonical projects root itself must remain physically inside repoRoot.
  if (!isWithinRoot(realRoot, realProjectsRoot)) return () => {};

  const watchers: fs.FSWatcher[] = [];
  const watchedDirs = new Set<string>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  const timerFor = (filePath: string, fn: () => void) => {
    safeClearTimeout(pending.get(filePath));
    const timer = setTimeout(() => {
      pending.delete(filePath);
      fn();
    }, debounceMs);
    pending.set(filePath, timer);
  };

  const indexOrQueue = (filePath: string) => {
    const fullPath = path.resolve(filePath);
    if (!isWithinRoot(projectsRoot, fullPath)) return;

    if (!fs.existsSync(fullPath)) {
      // A disappeared file has no realpath to validate, so constrain cleanup
      // by its canonical logical path before touching any indexed projection.
      if (!isMarkdownFile(fullPath)) return;

      const sourceFile = normalizeSourceFile(root, fullPath);
      if (!isPsiProjectsSource(sourceFile)) return;

      cleanupMissingProjectSource(sqlite, db, models, sourceFile);

      // macOS fs.watch may report only the old side of a rename. Reconcile
      // current canonical sources so a renamed/new path is indexed even when
      // no reliable second filesystem event arrives for the destination.
      indexMissingSources();
      return;
    }

    // Lexical containment is insufficient for symlinks. Resolve the actual
    // filesystem target and fail closed if it escapes the canonical projects root.
    let realPath: string;
    try { realPath = fs.realpathSync(fullPath); }
    catch { return; }
    if (!isWithinRoot(realProjectsRoot, realPath)) return;

    let stat: fs.Stats;
    try { stat = fs.statSync(fullPath); }
    catch { return; }

    if (stat.isDirectory()) {
      addWatchTree(fullPath);
      indexTree(fullPath);
      return;
    }
    if (!stat.isFile() || !isMarkdownFile(fullPath)) return;

    const sourceFile = normalizeSourceFile(root, fullPath);
    if (!isPsiProjectsSource(sourceFile)) return;

    let content: string;
    try { content = fs.readFileSync(fullPath, 'utf8'); }
    catch { return; }
    if (!content.trim()) return;

    const documents = parsePsiProjectFile(sourceFile, content);
    if (documents.length === 0) return;

    const chunked = chunkDocumentsForIndexing(documents);
    const ids = storeSqliteDocuments(sqlite, documents);
    supersedeReplacedSourceDocs(sqlite, chunked, currentTenantId());
    enqueueDocIds(sqlite, db, models, ids);
  };

  function indexTree(dir: string): void {
    for (const filePath of listFiles(dir, isMarkdownFile)) indexOrQueue(filePath);
  }

  function indexMissingSources(): void {
    for (const filePath of listFiles(projectsRoot, isMarkdownFile)) {
      const sourceFile = normalizeSourceFile(root, filePath);
      if (activeProjectIds(db, sourceFile).length === 0) {
        indexOrQueue(filePath);
      }
    }
  }

  function cleanupMissingSources(): void {
    for (const sourceFile of activeProjectSources(db)) {
      const fullPath = path.resolve(root, sourceFile);

      // Fail closed before allowing DB provenance to influence filesystem-based
      // reconciliation outside the canonical projects root.
      if (!isWithinRoot(projectsRoot, fullPath)) continue;
      if (!isMarkdownFile(fullPath)) continue;

      if (!fs.existsSync(fullPath)) {
        cleanupMissingProjectSource(sqlite, db, models, sourceFile);
      }
    }
  }

  function addWatchTree(dir: string): void {
    const resolved = path.resolve(dir);
    if (!isWithinRoot(projectsRoot, resolved) || watchedDirs.has(resolved)) return;

    let realDir: string;
    try { realDir = fs.realpathSync(resolved); }
    catch { return; }
    if (!isWithinRoot(realProjectsRoot, realDir)) return;

    const watcher = watchDir(resolved, (candidate) =>
      timerFor(candidate, () => indexOrQueue(candidate))
    );
    if (watcher) {
      watchedDirs.add(resolved);
      watchers.push(watcher);
    }
    for (const child of listDirs(resolved)) {
      if (path.resolve(child) !== resolved) addWatchTree(child);
    }
  }

  // Watching the root observes README edits and newly-created project dirs.
  addWatchTree(projectsRoot);

  // Startup convergence is bidirectional:
  // - active DB project sources missing from disk are cleaned;
  // - canonical disk sources missing from the active DB are indexed.
  // Existing active sources that still exist are left untouched.
  cleanupMissingSources();
  indexMissingSources();

  return () => {
    for (const [filePath, timer] of pending) {
      safeClearTimeout(timer);
      pending.delete(filePath);
    }
    safeClose(watchers);
  };
}
