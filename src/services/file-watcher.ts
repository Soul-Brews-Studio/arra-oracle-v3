import fs from 'fs';
import path from 'path';
import type { Database } from 'bun:sqlite';
import { sqlite } from '../db/index.ts';
import { REPO_ROOT } from '../config.ts';
import { getEmbeddingModels } from '../vector/factory.ts';
import { enqueueIndexJob } from '../indexer/jobs.ts';
import {
  PSI_LEARN_REL,
  isMarkdownFile,
  isPsiLearnSource,
  normalizeSourceFile,
  readPsiLearnDocuments,
  storeSqliteDocuments,
} from '../indexer/learn-doc-source.ts';
import { isWithinRoot, listDirs, safeClearTimeout, safeClose, watchDir } from '../indexer/watch-utils.ts';

type ModelRegistry = Record<string, { collection: string }>;
type WatcherEventType = 'started' | 'stopped' | 'scheduled' | 'indexed' | 'skipped' | 'error';

export interface WatcherEvent {
  type: WatcherEventType;
  at: string;
  path?: string;
  message: string;
  docs?: number;
  jobs?: number;
}

export interface FileWatcherStatus {
  running: boolean;
  watchRoot: string;
  debounceMs: number;
  watchedDirs: number;
  pending: number;
  events: WatcherEvent[];
}

export interface FileWatcherOptions {
  db?: Database;
  repoRoot?: string;
  debounceMs?: number;
  models?: ModelRegistry | (() => ModelRegistry);
  logger?: Pick<Console, 'log' | 'warn'>;
  maxEvents?: number;
}

const DEFAULT_DEBOUNCE_MS = 2_000;

export class FileWatcherService {
  private readonly db: Database;
  private readonly models: () => ModelRegistry;
  private readonly logger: Pick<Console, 'log' | 'warn'>;
  private readonly maxEvents: number;
  private readonly repoRoot: string;
  private readonly watchRoot: string;
  private debounceMs: number;
  private running = false;
  private watchers: fs.FSWatcher[] = [];
  private watchedDirs = new Set<string>();
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  private events: WatcherEvent[] = [];

  constructor(options: FileWatcherOptions = {}) {
    this.db = options.db ?? sqlite;
    const source = options.models ?? getEmbeddingModels;
    this.models = typeof source === 'function' ? source : () => source;
    this.logger = options.logger ?? console;
    this.maxEvents = options.maxEvents ?? 50;
    this.repoRoot = path.resolve(options.repoRoot ?? REPO_ROOT);
    this.watchRoot = path.join(this.repoRoot, PSI_LEARN_REL);
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  start(): FileWatcherStatus {
    if (this.running) return this.status();
    try {
      fs.mkdirSync(this.watchRoot, { recursive: true });
      this.addWatchers(this.watchRoot);
      this.running = this.watchers.length > 0;
      this.record('started', `watching ${this.watchRoot}`);
      this.logger.log(`[file-watcher] watching ${this.watchRoot}`);
    } catch (error) {
      this.record('error', `failed to start watcher: ${errorText(error)}`);
      this.logger.warn('[file-watcher] failed to start:', error);
    }
    return this.status();
  }

  stop(): FileWatcherStatus {
    for (const timer of this.pending.values()) safeClearTimeout(timer);
    this.pending.clear();
    safeClose(this.watchers);
    this.watchers = [];
    this.watchedDirs.clear();
    if (this.running) this.record('stopped', `stopped watching ${this.watchRoot}`);
    this.running = false;
    return this.status();
  }

  status(): FileWatcherStatus {
    return {
      running: this.running,
      watchRoot: this.watchRoot,
      debounceMs: this.debounceMs,
      watchedDirs: this.watchedDirs.size,
      pending: this.pending.size,
      events: [...this.events],
    };
  }

  schedule(filePath: string): void {
    const fullPath = path.resolve(filePath);
    if (!isWithinRoot(this.watchRoot, fullPath)) return;
    safeClearTimeout(this.pending.get(fullPath));
    const sourceFile = normalizeSourceFile(this.repoRoot, fullPath);
    this.record('scheduled', `scheduled re-index for ${sourceFile}`, sourceFile);
    this.pending.set(fullPath, setTimeout(() => {
      this.pending.delete(fullPath);
      this.reindexPath(fullPath);
    }, this.debounceMs));
  }

  private addWatchers(dir: string): void {
    for (const childDir of listDirs(dir)) {
      if (this.watchedDirs.has(childDir)) continue;
      const watcher = watchDir(childDir, (candidate) => this.schedule(candidate));
      if (!watcher) continue;
      this.watchers.push(watcher);
      this.watchedDirs.add(childDir);
    }
  }

  private reindexPath(filePath: string): void {
    if (!fs.existsSync(filePath)) return this.skip(filePath, 'path no longer exists');
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      this.addWatchers(filePath);
      return;
    }

    const sourceFile = normalizeSourceFile(this.repoRoot, filePath);
    if (!stat.isFile() || !isMarkdownFile(filePath) || !isPsiLearnSource(sourceFile)) {
      return this.skip(filePath, 'not a ψ/learn markdown file');
    }

    try {
      const ids = storeSqliteDocuments(this.db, readPsiLearnDocuments(this.repoRoot, filePath));
      const jobs = this.enqueue(ids);
      this.record('indexed', `re-indexed ${sourceFile}: ${ids.length} docs, ${jobs} jobs`, sourceFile, ids.length, jobs);
      this.logger.log(`[file-watcher] re-indexed ${sourceFile}: ${ids.length} docs, ${jobs} jobs`);
    } catch (error) {
      this.record('error', `failed to re-index ${sourceFile}: ${errorText(error)}`, sourceFile);
      this.logger.warn(`[file-watcher] failed to re-index ${sourceFile}:`, error);
    }
  }

  private enqueue(ids: string[]): number {
    const models = this.models();
    let count = 0;
    for (const id of ids) {
      if (this.hasActiveJob(id)) continue;
      count += enqueueIndexJob(this.db, { docId: id, models }).length;
    }
    return count;
  }

  private hasActiveJob(docId: string): boolean {
    const row = this.db.query<{ count: number }, [string]>(
      `SELECT COUNT(*) AS count FROM indexing_jobs
       WHERE doc_id = ? AND status IN ('pending', 'claimed')`,
    ).get(docId);
    return (row?.count ?? 0) > 0;
  }

  private skip(filePath: string, reason: string): void {
    const sourceFile = normalizeSourceFile(this.repoRoot, filePath);
    this.record('skipped', `${reason}: ${sourceFile}`, sourceFile);
  }

  private record(type: WatcherEventType, message: string, sourceFile?: string, docs?: number, jobs?: number): void {
    this.events.unshift({ type, at: new Date().toISOString(), path: sourceFile, message, docs, jobs });
    this.events = this.events.slice(0, this.maxEvents);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const fileWatcherService = new FileWatcherService();
