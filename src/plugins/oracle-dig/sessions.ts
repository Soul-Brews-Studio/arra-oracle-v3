import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

export const ORACLE_SESSIONS_SINGLE_MACHINE_NOTE =
  'oracle_sessions is single-machine only: it scans local ~/.claude/projects/*/*.jsonl transcripts and is not fleet-wide.';

type JsonObject = Record<string, unknown>;

export interface OracleSessionsOptions {
  homeDir?: string;
  projectsDir?: string;
  limit?: number;
}

export interface OracleSessionSummary {
  sessionId: string;
  project: string;
  path: string;
  messageCount: number;
  userMessages: number;
  assistantMessages: number;
  oracle?: string;
  firstTimestamp?: number;
  lastTimestamp?: number;
  preview?: string;
}

export interface OracleSessionsResult {
  capability: 'oracle_sessions';
  scope: 'single-machine';
  note: string;
  root: string;
  total: number;
  sessions: OracleSessionSummary[];
}

/**
 * Single-machine capability: scans only this host's local Claude JSONL cache.
 * It intentionally does not claim fleet-wide/federated session visibility.
 */
export async function oracleSessions(options: OracleSessionsOptions = {}): Promise<OracleSessionsResult> {
  const root = options.projectsDir ?? join(options.homeDir ?? homedir(), '.claude', 'projects');
  const files = await listJsonlFiles(root);
  const sessions = [] as OracleSessionSummary[];
  for (const file of files) sessions.push(await summarizeSession(file.path, file.project));
  sessions.sort((a, b) => (b.lastTimestamp ?? 0) - (a.lastTimestamp ?? 0) || a.path.localeCompare(b.path));
  const limit = boundedLimit(options.limit, sessions.length);
  return {
    capability: 'oracle_sessions',
    scope: 'single-machine',
    note: ORACLE_SESSIONS_SINGLE_MACHINE_NOTE,
    root,
    total: sessions.length,
    sessions: sessions.slice(0, limit),
  };
}

export const scanOracleSessions = oracleSessions;
export const oracle_sessions = oracleSessions;

async function listJsonlFiles(root: string): Promise<Array<{ path: string; project: string }>> {
  try {
    if (!(await stat(root)).isDirectory()) return [];
  } catch {
    return [];
  }
  const projects = await readdir(root, { withFileTypes: true });
  const files = [] as Array<{ path: string; project: string }>;
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const projectDir = join(root, project.name);
    for (const entry of await readdir(projectDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push({ path: join(projectDir, entry.name), project: project.name });
      }
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function summarizeSession(path: string, project: string): Promise<OracleSessionSummary> {
  const lines = (await readFile(path, 'utf8')).split(/\r?\n/);
  const summary: OracleSessionSummary = {
    sessionId: basename(path, '.jsonl'),
    project,
    path,
    messageCount: 0,
    userMessages: 0,
    assistantMessages: 0,
  };

  for (const line of lines) {
    const row = parseLine(line);
    if (!row) continue;
    summary.messageCount += 1;
    summary.sessionId = stringField(row, 'sessionId') ?? stringField(row, 'session_id') ?? summary.sessionId;
    summary.oracle = summary.oracle ?? stringField(row, 'oracle') ?? stringField(row, 'model') ?? stringField(asObject(row.message), 'model');
    const role = stringField(asObject(row.message), 'role') ?? stringField(row, 'role') ?? stringField(row, 'type');
    if (role === 'user') summary.userMessages += 1;
    if (role === 'assistant') summary.assistantMessages += 1;
    const timestamp = timestampMs(row.timestamp ?? row.created_at ?? row.createdAt);
    if (timestamp !== undefined) {
      summary.firstTimestamp = Math.min(summary.firstTimestamp ?? timestamp, timestamp);
      summary.lastTimestamp = Math.max(summary.lastTimestamp ?? timestamp, timestamp);
    }
    summary.preview = summary.preview ?? clippedText(extractText(row));
  }

  return summary;
}

function parseLine(line: string): JsonObject | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return asObject(parsed);
  } catch {
    return undefined;
  }
}

function extractText(row: JsonObject): string | undefined {
  const message = asObject(row.message);
  return textFromValue(message?.content) ?? textFromValue(row.content) ?? textFromValue(row.text);
}

function textFromValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((part) => textFromValue(part)).filter(Boolean).join(' ');
  const object = asObject(value);
  return object ? textFromValue(object.text) : undefined;
}

function clippedText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

function timestampMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

function stringField(object: JsonObject | undefined, key: string): string | undefined {
  const value = object?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function boundedLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.trunc(value!));
}
