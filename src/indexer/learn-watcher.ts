/**
 * Auto queue learn documents when files change under ψ/memory/learnings.
 *
 * The watcher maps changed Markdown files to existing `oracle_documents`
 * rows by `source_file` and enqueues one queue job per registered model.
 *
 * This keeps vector indexing incremental and avoids expensive full reindex runs
 * when a single learning file is edited.
 */

import fs from 'fs';
import path from 'path';
import type Database from 'bun:sqlite';
import { enqueueIndexJob } from './jobs.ts';
import { REPO_ROOT } from '../config.ts';

export interface LearnWatcherOptions {
  /** sqlite database used by enqueueIndexJob(). */
  db: Database;
  /** Model registry from vector/factory.getEmbeddingModels(). */
  models: Record<string, { collection: string }>;
  /** Repo root that owns ψ/memory/learnings. Defaults to REPO_ROOT. */
  repoRoot?: string;
  /** Debounce window in ms to collapse bursty editor saves. */
  debounceMs?: number;
}

export type StopWatch = () => void;

const DEFAULT_DEBOUNCE_MS = 250;
const LEARN_DIR_REL = path.join('\u03c8', 'memory', 'learnings');

function normalizeSourceFile(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function isMarkdownFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

function safeClose(watchers: Array<{ close: () => void }>): void {
  for (const watcher of watchers) {
    try {
      watcher.close();
    } catch {
      // Intentionally best-effort.
    }
  }
}

function safeClearTimeout(id: ReturnType<typeof setTimeout> | undefined): void {
  if (id !== undefined) {
    clearTimeout(id);
  }
}

function enqueueBySourceFile(db: Database, models: Record<string, { collection: string }>, sourceFile: string): number {
  const rows = db
    .query<{ id: string }, [string]>(
      `SELECT id
       FROM oracle_documents
       WHERE source_file = ? AND type = 'learning' AND superseded_at IS NULL`,
    )
    .all(sourceFile);

  for (const row of rows) {
    try {
      enqueueIndexJob(db, { docId: row.id, models });
    } catch {
      // Never throw while watching files — indexing is eventually consistent.
      continue;
    }
  }
  return rows.length;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
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
  const learnDir = path.join(root, LEARN_DIR_REL);

  if (!fs.existsSync(learnDir)) {
    return () => {};
  }

  const watchers: Array<fs.FSWatcher> = [];
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const timerFor = (filePath: string, fn: () => void) => {
    const existing = pending.get(filePath);
    safeClearTimeout(existing);

    const timer = setTimeout(() => {
      pending.delete(filePath);
      fn();
    }, debounceMs);
    pending.set(filePath, timer);
  };

  const enqueueFromPath = (eventPath: string) => {
    const fullPath = path.resolve(eventPath);
    if (!isWithinRoot(learnDir, fullPath)) return;
    if (!fs.existsSync(fullPath) || !isMarkdownFile(fullPath)) return;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      return;
    }
    if (!stat.isFile()) return;

    const sourceFile = normalizeSourceFile(root, fullPath);
    if (sourceFile.endsWith('/')) return;

    const count = enqueueBySourceFile(db, models, sourceFile);
    if (count === 0) {
      console.log(`[learn-watch] no oracle_documents rows for ${sourceFile}`);
    }
  };

  const onFileEvent = (_event: string, filename: string | null): void => {
    if (!filename) return;
    const candidate = path.join(learnDir, filename);
    timerFor(candidate, () => {
      enqueueFromPath(candidate);
    });
  };

  try {
    const watcher = fs.watch(learnDir, { persistent: false, recursive: true }, onFileEvent);
    watchers.push(watcher);
  } catch {
    // `recursive` may fail on some Bun/platform combos; fallback to shallow watch.
    const watcher = fs.watch(learnDir, { persistent: false }, onFileEvent);
    watchers.push(watcher);
  }

  return () => {
    for (const [p, timer] of pending) {
      safeClearTimeout(timer);
      pending.delete(p);
    }
    safeClose(watchers);
  };
}
