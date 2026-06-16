/**
 * Auto-index learn documents when files change under ψ/memory/learnings or ψ/learn.
 *
 * Existing indexed learning files are re-queued by source_file. New ψ/learn
 * and ψ/memory/learnings Markdown files are inserted into SQLite/FTS first,
 * then queued for vector jobs.
 */

import fs from 'fs';
import path from 'path';
import type Database from 'bun:sqlite';
import { enqueueIndexJob } from './jobs.ts';
import { REPO_ROOT } from '../config.ts';
import {
  MEMORY_LEARN_REL,
  PSI_LEARN_REL,
  isMarkdownFile,
  isMemoryLearningSource,
  isPsiLearnSource,
  normalizeSourceFile,
  readLearningDocuments,
  storeSqliteDocuments,
} from './learn-doc-source.ts';
import { isWithinRoot, listDirs, listFiles, safeClearTimeout, safeClose, watchDir } from './watch-utils.ts';

export interface LearnWatcherOptions {
  /** sqlite database used by enqueueIndexJob(). */
  db: Database;
  /** Model registry from vector/factory.getEmbeddingModels(). */
  models: Record<string, { collection: string }>;
  /** Repo root that owns ψ memory/learn sources. Defaults to REPO_ROOT. */
  repoRoot?: string;
  /** Debounce window in ms to collapse bursty editor saves. */
  debounceMs?: number;
}

export type StopWatch = () => void;

const DEFAULT_DEBOUNCE_MS = 250;

function hasActiveJobs(db: Database, docId: string): boolean {
  const row = db.query<{ count: number }, [string]>(
    `SELECT COUNT(*) AS count FROM indexing_jobs
     WHERE doc_id = ? AND status IN ('pending', 'claimed')`,
  ).get(docId);
  return (row?.count ?? 0) > 0;
}

function enqueueDocIds(db: Database, models: Record<string, { collection: string }>, ids: string[]): number {
  let count = 0;
  for (const id of ids) {
    if (hasActiveJobs(db, id)) continue;
    try { count += enqueueIndexJob(db, { docId: id, models }).length; } catch { continue; }
  }
  return count;
}

function existingLearningIds(db: Database, sourceFile: string): string[] {
  return db.query<{ id: string }, [string]>(
    `SELECT id FROM oracle_documents
     WHERE source_file = ? AND type = 'learning' AND superseded_at IS NULL`,
  ).all(sourceFile).map((row) => row.id);
}

function shouldAutoStore(sourceFile: string): boolean {
  return isPsiLearnSource(sourceFile) || isMemoryLearningSource(sourceFile);
}

/**
 * Start a file watcher for learn-source Markdown files.
 *
 * Returns a stop function that closes all fs watchers and clears pending timers.
 */
export function startLearnWatcher({
  db,
  models,
  repoRoot = REPO_ROOT,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: LearnWatcherOptions): StopWatch {
  const root = path.resolve(repoRoot);
  const roots = [path.join(root, MEMORY_LEARN_REL), path.join(root, PSI_LEARN_REL)]
    .filter((dir) => fs.existsSync(dir));

  if (roots.length === 0) return () => {};

  const watchers: Array<fs.FSWatcher> = [];
  const watchedDirs = new Set<string>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  const timerFor = (filePath: string, fn: () => void) => {
    safeClearTimeout(pending.get(filePath));
    const timer = setTimeout(() => { pending.delete(filePath); fn(); }, debounceMs);
    pending.set(filePath, timer);
  };

  const indexOrQueue = (filePath: string) => {
    const fullPath = path.resolve(filePath);
    if (!roots.some((sourceRoot) => isWithinRoot(sourceRoot, fullPath))) return;
    if (!fs.existsSync(fullPath)) return;

    let stat: fs.Stats;
    try { stat = fs.statSync(fullPath); } catch { return; }
    if (stat.isDirectory()) { addWatchers(fullPath); return; }
    if (!stat.isFile() || !isMarkdownFile(fullPath)) return;

    const sourceFile = normalizeSourceFile(root, fullPath);
    let ids = existingLearningIds(db, sourceFile);
    if (ids.length === 0 && shouldAutoStore(sourceFile)) {
      try {
        ids = storeSqliteDocuments(db, readLearningDocuments(root, fullPath));
      } catch (error) {
        console.warn(`[learn-watch] failed to index ${sourceFile}:`, error);
        return;
      }
    }

    if (ids.length === 0) {
      console.log(`[learn-watch] no oracle_documents rows for ${sourceFile}`);
      return;
    }
    enqueueDocIds(db, models, ids);
  };

  function addWatchers(dir: string): void {
    for (const childDir of listDirs(dir)) {
      if (watchedDirs.has(childDir)) continue;
      const watcher = watchDir(childDir, (candidate) => timerFor(candidate, () => indexOrQueue(candidate)));
      if (!watcher) continue;
      watchedDirs.add(childDir);
      watchers.push(watcher);
    }
  }

  for (const sourceRoot of roots) addWatchers(sourceRoot);

  for (const sourceRoot of roots) {
    for (const filePath of listFiles(sourceRoot, isMarkdownFile)) {
      const sourceFile = normalizeSourceFile(root, filePath);
      if (existingLearningIds(db, sourceFile).length === 0) indexOrQueue(filePath);
    }
  }

  return () => {
    for (const [p, timer] of pending) { safeClearTimeout(timer); pending.delete(p); }
    safeClose(watchers);
  };
}
