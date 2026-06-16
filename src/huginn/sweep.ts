import fs from 'fs';
import path from 'path';
import { ORACLE_DATA_DIR, REPO_ROOT } from '../config.ts';
import { captureSession, defaultStatePath, type HuginnCaptureResult } from './capture.ts';
import { currentTenantId } from '../middleware/tenant.ts';

export interface HuginnSweepOptions {
  sessionDirs?: string[];
  repoRoot?: string;
  statePath?: string;
  lookbackHours?: number;
  maxFiles?: number;
  now?: number;
  cwd?: string;
  learn?: Parameters<typeof captureSession>[0]['learn'];
  indexMarkdown?: (filePath: string, sourceFile: string) => unknown;
  log?: (message: string) => void;
}

export interface HuginnSweepState {
  captures: Record<string, { sessionId: string; hash: string; capturedAt: string; learningId?: string }>;
  sweeps?: { lastSweepAtMs?: number; lastStartedAtMs?: number; lastSummary?: HuginnSweepSummary };
}

export interface HuginnSweepSummary {
  ok: boolean;
  startedAtMs: number;
  watermarkBeforeMs?: number;
  watermarkAfterMs: number;
  scanned: number;
  learned: number;
  duplicates: number;
  empty: number;
  missing: number;
  markdownIndexed: number;
  markdownAlreadyIndexed: number;
  capped: boolean;
  files: Array<{ path: string; action: string; sessionId?: string; hash?: string; sourceFile?: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readSweepState(statePath: string): HuginnSweepState {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    return {
      captures: isRecord(parsed) && isRecord(parsed.captures) ? parsed.captures as HuginnSweepState['captures'] : {},
      sweeps: isRecord(parsed) && isRecord(parsed.sweeps) ? parsed.sweeps as HuginnSweepState['sweeps'] : {},
    };
  } catch {
    return { captures: {}, sweeps: {} };
  }
}

function writeSweepState(statePath: string, state: HuginnSweepState): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, statePath);
}

function defaultSessionDirs(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const configured = process.env.ARRA_HUGINN_SWEEP_DIRS || process.env.ORACLE_HUGINN_SWEEP_DIRS;
  if (configured) return configured.split(path.delimiter).filter(Boolean);
  return [
    path.join(ORACLE_DATA_DIR, 'sessions'),
    path.join(home, '.codex', 'sessions'),
    path.join(home, '.claude', 'projects'),
  ].filter(Boolean);
}

function walkRecentFiles(root: string, sinceMs: number, out: string[], maxFiles: number): boolean {
  if (out.length >= maxFiles) return true;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return false; }
  for (const entry of entries) {
    if (out.length >= maxFiles) return true;
    const full = path.join(root, entry.name);
    let stat: fs.Stats;
    try { stat = fs.statSync(full); } catch { continue; }
    if (entry.isDirectory()) {
      // If the directory itself is old, still recurse: session stores often bucket by old date dirs.
      if (walkRecentFiles(full, sinceMs, out, maxFiles)) return true;
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    if (stat.mtimeMs <= sinceMs) continue;
    out.push(full);
  }
  return out.length >= maxFiles;
}

function sourceFileForMarkdown(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function safeSessionIdFromFile(filePath: string): string {
  return path.basename(filePath).replace(/\.jsonl$/i, '');
}

async function defaultIndexMarkdown(filePath: string, sourceFile: string): Promise<void> {
  const [{ createDatabase }, { parseLearningFile }, { storeDocuments }] = await Promise.all([
    import('../db/index.ts'),
    import('../indexer/parser.ts'),
    import('../indexer/storage.ts'),
  ]);
  const { sqlite, db } = createDatabase();
  try {
    const tenantId = currentTenantId();
    const exists = tenantId
      ? sqlite.prepare('SELECT id FROM oracle_documents WHERE source_file = ? AND tenant_id = ? LIMIT 1').get(sourceFile, tenantId)
      : sqlite.prepare('SELECT id FROM oracle_documents WHERE source_file = ? LIMIT 1').get(sourceFile);
    if (exists) return;
    const content = fs.readFileSync(filePath, 'utf-8');
    const docs = parseLearningFile(path.basename(filePath), content, sourceFile);
    const originalLog = console.log;
    try {
      console.log = () => {};
      await storeDocuments(sqlite, db, null, null, docs);
    } finally {
      console.log = originalLog;
    }
  } finally {
    sqlite.close();
  }
}

async function markdownIndexed(sourceFile: string): Promise<boolean> {
  const { createDatabase } = await import('../db/index.ts');
  const { sqlite } = createDatabase();
  try {
    const tenantId = currentTenantId();
    return Boolean(tenantId
      ? sqlite.prepare('SELECT id FROM oracle_documents WHERE source_file = ? AND tenant_id = ? LIMIT 1').get(sourceFile, tenantId)
      : sqlite.prepare('SELECT id FROM oracle_documents WHERE source_file = ? LIMIT 1').get(sourceFile));
  } finally {
    sqlite.close();
  }
}

export async function sweepHuginn(options: HuginnSweepOptions = {}): Promise<HuginnSweepSummary> {
  const now = options.now ?? Date.now();
  const statePath = options.statePath ?? defaultStatePath();
  const state = readSweepState(statePath);
  const lookbackMs = (options.lookbackHours ?? Number(process.env.ARRA_HUGINN_SWEEP_LOOKBACK_HOURS || 24)) * 60 * 60 * 1000;
  const watermarkBeforeMs = state.sweeps?.lastSweepAtMs;
  const sinceMs = watermarkBeforeMs ?? now - lookbackMs;
  const maxFiles = options.maxFiles ?? Number(process.env.ARRA_HUGINN_SWEEP_MAX_FILES || 200);
  const files: HuginnSweepSummary['files'] = [];
  const summary: HuginnSweepSummary = {
    ok: true,
    startedAtMs: now,
    watermarkBeforeMs,
    watermarkAfterMs: now,
    scanned: 0,
    learned: 0,
    duplicates: 0,
    empty: 0,
    missing: 0,
    markdownIndexed: 0,
    markdownAlreadyIndexed: 0,
    capped: false,
    files,
  };

  const candidates: string[] = [];
  for (const dir of options.sessionDirs ?? defaultSessionDirs()) {
    summary.capped = walkRecentFiles(dir, sinceMs, candidates, maxFiles) || summary.capped;
    if (summary.capped) break;
  }

  for (const transcriptPath of candidates.sort()) {
    summary.scanned++;
    const result: HuginnCaptureResult = await captureSession({
      transcriptPath,
      sessionId: safeSessionIdFromFile(transcriptPath),
      cwd: options.cwd,
      statePath,
      learn: options.learn,
    });
    if (result.learned) summary.learned++;
    else if (result.skipped === 'duplicate') summary.duplicates++;
    else if (result.skipped === 'empty') summary.empty++;
    else if (result.skipped === 'missing-transcript') summary.missing++;
    files.push({ path: transcriptPath, action: result.learned ? 'learned' : result.skipped ?? 'skipped', sessionId: result.sessionId, hash: result.hash });
  }

  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const learningsDir = path.join(repoRoot, 'ψ', 'memory', 'learnings');
  const markdowns: string[] = [];
  walkRecentFiles(learningsDir, sinceMs, [], 0); // no-op guard for missing dir parity
  if (fs.existsSync(learningsDir)) {
    const collectMd = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { collectMd(full); continue; }
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        const stat = fs.statSync(full);
        if (stat.mtimeMs > sinceMs) markdowns.push(full);
      }
    };
    collectMd(learningsDir);
  }

  for (const filePath of markdowns.sort()) {
    const sourceFile = sourceFileForMarkdown(repoRoot, filePath);
    const already = options.indexMarkdown ? false : await markdownIndexed(sourceFile);
    if (already) {
      summary.markdownAlreadyIndexed++;
      files.push({ path: filePath, action: 'markdown-already-indexed', sourceFile });
      continue;
    }
    await (options.indexMarkdown ?? defaultIndexMarkdown)(filePath, sourceFile);
    summary.markdownIndexed++;
    files.push({ path: filePath, action: 'markdown-indexed', sourceFile });
  }

  const latest = readSweepState(statePath);
  latest.sweeps = { lastStartedAtMs: now, lastSweepAtMs: now, lastSummary: summary };
  writeSweepState(statePath, latest);
  options.log?.(`Huginn sweep scanned ${summary.scanned} session JSONL, learned ${summary.learned}, duplicates ${summary.duplicates}, indexed ${summary.markdownIndexed} markdown files${summary.capped ? ' (capped)' : ''}.`);
  return summary;
}
