import fs from 'fs';
import path from 'path';
import type { Database } from 'bun:sqlite';
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
import { isWithinRoot, listDirs, listFiles, safeClearTimeout, safeClose, watchDir } from '../indexer/watch-utils.ts';

type ModelRegistry = Record<string, { collection: string }>;
type WatcherEventType = 'started' | 'stopped' | 'scheduled' | 'indexed' | 'skipped' | 'error';

export interface WatcherEvent { type: WatcherEventType; at: string; path?: string; message: string; docs?: number; jobs?: number; }

export interface FileWatcherStatus { running: boolean; watchRoot: string; debounceMs: number; watchedDirs: number; pending: number; events: WatcherEvent[]; }

export interface FileWatcherControl {
  start(): FileWatcherStatus; stop(): FileWatcherStatus; restart(): FileWatcherStatus; status(): FileWatcherStatus;
  schedule(filePath: string): void;
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
const DEFAULT_MAX_EVENTS = 50;

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

function defaultDatabase(): Database { return (require('../db/index.ts') as { sqlite: Database }).sqlite; }

export class FileWatcherService implements FileWatcherControl {
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
    this.db = options.db ?? defaultDatabase();
    const source = options.models ?? getEmbeddingModels;
    this.models = typeof source === 'function' ? source : () => source;
    this.logger = options.logger ?? console;
    this.maxEvents = Math.max(1, nonNegativeInteger(options.maxEvents, DEFAULT_MAX_EVENTS));
    this.repoRoot = path.resolve(options.repoRoot ?? REPO_ROOT);
    this.watchRoot = path.join(this.repoRoot, PSI_LEARN_REL);
    this.debounceMs = nonNegativeInteger(options.debounceMs, DEFAULT_DEBOUNCE_MS);
  }

  start(): FileWatcherStatus {
    if (this.running) return this.watchers.length ? this.status() : this.restart();
    try {
      fs.mkdirSync(this.watchRoot, { recursive: true });
      this.addWatchers(this.watchRoot);
      this.running = this.watchers.length > 0;
      if (this.running) {
        this.record('started', `watching ${this.watchRoot}`);
        this.logger.log(`[file-watcher] watching ${this.watchRoot}`);
      } else {
        this.record('error', `no watchable directories under ${this.watchRoot}`);
        this.logger.warn(`[file-watcher] no watchable directories under ${this.watchRoot}`);
      }
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

  restart(): FileWatcherStatus { this.stop(); return this.start(); }
  status(): FileWatcherStatus {
    return {
      running: this.running,
      watchRoot: this.watchRoot,
      debounceMs: this.debounceMs,
      watchedDirs: this.watchedDirs.size,
      pending: this.pending.size,
      events: this.events.map((event) => ({ ...event })),
    };
  }

  schedule(filePath: string): void {
    if (!this.running) return;
    if (typeof filePath !== 'string' || !filePath.trim()) return;
    const fullPath = path.resolve(filePath);
    if (!isWithinRoot(this.watchRoot, fullPath)) return;
    safeClearTimeout(this.pending.get(fullPath));
    const sourceFile = normalizeSourceFile(this.repoRoot, fullPath);
    this.record('scheduled', `scheduled re-index for ${sourceFile}`, sourceFile);
    this.pending.set(fullPath, setTimeout(() => {
      this.pending.delete(fullPath);
      try {
        this.reindexPath(fullPath);
      } catch (error) {
        this.record('error', `failed scheduled re-index for ${sourceFile}: ${errorText(error)}`, sourceFile);
        this.logger.warn(`[file-watcher] failed scheduled re-index for ${sourceFile}:`, error);
      }
    }, this.debounceMs));
  }

  private addWatchers(dir: string): void {
    let dirs: string[];
    try {
      dirs = listDirs(dir);
    } catch (error) {
      this.record('error', `failed to scan watcher directories: ${errorText(error)}`);
      this.logger.warn(`[file-watcher] failed to scan watcher directories for ${dir}:`, error);
      return;
    }
    for (const childDir of dirs) {
      if (this.watchedDirs.has(childDir)) continue;
      const watcher = watchDir(childDir, (candidate) => this.schedule(candidate));
      if (!watcher) continue;
      this.watchers.push(watcher);
      this.watchedDirs.add(childDir);
    }
  }

  private reindexPath(filePath: string): void {
    let stat: fs.Stats;
    try {
      if (!fs.existsSync(filePath)) return this.skip(filePath, 'path no longer exists');
      stat = fs.statSync(filePath);
    } catch (error) {
      const sourceFile = normalizeSourceFile(this.repoRoot, filePath);
      this.record('error', `failed to inspect ${sourceFile}: ${errorText(error)}`, sourceFile);
      this.logger.warn(`[file-watcher] failed to inspect ${sourceFile}:`, error);
      return;
    }
    if (stat.isDirectory()) {
      this.addWatchers(filePath);
      this.indexMarkdownTree(filePath);
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

  private indexMarkdownTree(dir: string): void {
    try {
      for (const filePath of listFiles(dir, isMarkdownFile)) this.reindexPath(filePath);
    } catch (error) {
      this.record('error', `failed to scan markdown tree: ${errorText(error)}`);
      this.logger.warn(`[file-watcher] failed to scan markdown tree for ${dir}:`, error);
    }
  }

  private enqueue(ids: string[]): number {
    let models: ModelRegistry;
    try {
      models = this.models();
    } catch (error) {
      this.record('error', `failed to resolve vector models: ${errorText(error)}`);
      this.logger.warn('[file-watcher] failed to resolve vector models:', error);
      return 0;
    }
    let count = 0;
    for (const id of ids) {
      try {
        if (this.hasActiveJob(id)) continue;
        count += enqueueIndexJob(this.db, { docId: id, models }).length;
      } catch (error) {
        this.record('error', `failed to enqueue vector jobs for ${id}: ${errorText(error)}`);
        this.logger.warn(`[file-watcher] failed to enqueue vector jobs for ${id}:`, error);
      }
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
class LazyFileWatcherService implements FileWatcherControl {
  private service?: FileWatcherService;
  private get current(): FileWatcherService { return this.service ??= new FileWatcherService(); }
  start(): FileWatcherStatus { return this.current.start(); }
  stop(): FileWatcherStatus { return this.current.stop(); }
  restart(): FileWatcherStatus { return this.current.restart(); }
  status(): FileWatcherStatus { return this.current.status(); }
  schedule(filePath: string): void { this.current.schedule(filePath); }
}

export const fileWatcherService: FileWatcherControl = new LazyFileWatcherService();
