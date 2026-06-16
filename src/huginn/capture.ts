import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ORACLE_DATA_DIR } from '../config.ts';

export interface HuginnCaptureOptions {
  transcriptPath: string;
  sessionId?: string;
  cwd?: string;
  maxItems?: number;
  statePath?: string;
  learn?: (pattern: string, source?: string, concepts?: string[], origin?: string, project?: string, cwd?: string) => unknown;
}

export interface HuginnMoment {
  kind: 'decision' | 'learning' | 'file-change' | 'issue' | 'command' | 'summary';
  text: string;
}

export interface HuginnCaptureResult {
  ok: boolean;
  skipped?: 'disabled' | 'missing-transcript' | 'empty' | 'duplicate';
  sessionId?: string;
  hash?: string;
  learned?: boolean;
  learningId?: string;
  sourceFile?: string;
  moments: HuginnMoment[];
}

interface CaptureState {
  captures: Record<string, { sessionId: string; hash: string; capturedAt: string; learningId?: string }>;
}

const SALIENT = /\b(decision|decided|learned|learning|root cause|fix(?:ed)?|bug|regression|issue\s*#?\d+|pr\s*#?\d+|merged|verified|test(?:s)?\s+(?:pass|green|fail)|implemented|changed|added|removed|deleted|refactor|migration|blocker|risk|todo|follow[- ]?up)\b/i;
const FILE_HINT = /(?:^|\s)([\w./-]+\.(?:ts|tsx|js|jsx|json|md|yml|yaml|toml|sh|sql|css|html|py|rs|go))\b/g;

export function huginnEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(env.ARRA_HUGINN_CAPTURE ?? env.ORACLE_HUGINN_CAPTURE ?? '').toLowerCase());
}

export function defaultStatePath(): string {
  return path.join(process.env.ORACLE_DATA_DIR || ORACLE_DATA_DIR, 'huginn-captures.json');
}

export function readHookInput(raw: string, env: NodeJS.ProcessEnv = process.env): { transcriptPath?: string; sessionId?: string; cwd?: string } {
  const trimmed = raw.trim();
  let parsed: any = null;
  if (trimmed) {
    try { parsed = JSON.parse(trimmed); } catch {}
  }
  return {
    transcriptPath: parsed?.transcript_path || parsed?.transcriptPath || parsed?.session_path || parsed?.sessionPath || env.CODEX_SESSION_FILE || env.CLAUDE_TRANSCRIPT_PATH || env.TRANSCRIPT_PATH,
    sessionId: parsed?.session_id || parsed?.sessionId || env.CODEX_SESSION_ID || env.CLAUDE_SESSION_ID,
    cwd: parsed?.cwd || parsed?.workspace || env.ORACLE_REPO_ROOT || process.cwd(),
  };
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readState(statePath: string): CaptureState {
  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    const captures = isRecord(parsed) && isRecord(parsed.captures) ? parsed.captures : {};
    return { captures: captures as CaptureState['captures'] };
  } catch {
    return { captures: {} };
  }
}

function isReadableFile(filePath: string): boolean {
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}

function writeState(statePath: string, state: CaptureState): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, statePath);
}

function stableSessionId(transcriptPath: string, explicit?: string): string {
  if (explicit) return explicit.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120);
  const base = path.basename(transcriptPath).replace(/\.jsonl$/i, '');
  return (base || sha256(transcriptPath).slice(0, 16)).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120);
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part: any) => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      if (typeof part?.content === 'string') return part.content;
      if (part?.type === 'tool_use') return `[tool:${part.name ?? 'unknown'} ${JSON.stringify(part.input ?? {})}]`;
      if (part?.type === 'tool_result') return typeof part.content === 'string' ? part.content : JSON.stringify(part.content ?? '');
      return '';
    }).filter(Boolean).join('\n');
  }
  return '';
}

function lineToText(obj: any): string {
  const message = obj?.message ?? obj;
  const role = message?.role || obj?.role || obj?.type || 'event';
  const text = textFromContent(message?.content ?? obj?.content ?? obj?.text ?? obj?.message);
  return text ? `${role}: ${text}` : '';
}

function classify(text: string): HuginnMoment['kind'] {
  if (/\b(decision|decided|rejected|chosen)\b/i.test(text)) return 'decision';
  if (/\b(learned|learning|root cause|insight)\b/i.test(text)) return 'learning';
  if (/\b(issue\s*#?\d+|pr\s*#?\d+|merged|closed)\b/i.test(text)) return 'issue';
  if (/\b(bun test|bun run|npm|git |gh |docker|curl)\b/i.test(text)) return 'command';
  FILE_HINT.lastIndex = 0;
  if (FILE_HINT.test(text)) {
    FILE_HINT.lastIndex = 0;
    return 'file-change';
  }
  return 'summary';
}

function compact(text: string, max = 360): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

function normalizeMaxItems(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 12;
  return Math.floor(value);
}

export function mineSessionJsonl(transcriptPath: string, maxItems = 12): { moments: HuginnMoment[]; hash: string; sourceText: string } {
  if (!isReadableFile(transcriptPath)) return { moments: [], hash: '', sourceText: '' };
  let raw = '';
  try { raw = fs.readFileSync(transcriptPath, 'utf-8'); } catch { return { moments: [], hash: '', sourceText: '' }; }
  const selected: HuginnMoment[] = [];
  const seen = new Set<string>();
  const limit = normalizeMaxItems(maxItems);

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }
    const text = lineToText(obj);
    if (!text || !SALIENT.test(text)) continue;
    const clipped = compact(text);
    if (clipped.length < 24) continue;
    const key = sha256(clipped).slice(0, 16);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push({ kind: classify(clipped), text: clipped });
    if (selected.length >= limit) break;
  }

  const sourceText = selected.map((m) => `${m.kind}: ${m.text}`).join('\n');
  return { moments: selected, hash: sha256(sourceText || raw), sourceText };
}

export function formatLearning(sessionId: string, moments: HuginnMoment[], transcriptPath: string): string {
  const title = `Huginn auto-capture session ${sessionId}`;
  const lines = [
    title,
    '',
    `Transcript: ${transcriptPath}`,
    `Captured: ${new Date().toISOString()}`,
    '',
    'Salient moments:',
    ...moments.map((m) => `- [${m.kind}] ${m.text}`),
    '',
    'This passive learning was mined from a session JSONL by the opt-in Huginn Stop/PreCompact hook.',
  ];
  return lines.join('\n');
}

export async function captureSession(options: HuginnCaptureOptions): Promise<HuginnCaptureResult> {
  const sessionId = stableSessionId(options.transcriptPath, options.sessionId);
  if (!isReadableFile(options.transcriptPath)) return { ok: true, skipped: 'missing-transcript', sessionId, moments: [] };

  const mined = mineSessionJsonl(options.transcriptPath, options.maxItems ?? 12);
  if (mined.moments.length === 0) return { ok: true, skipped: 'empty', sessionId, hash: mined.hash, moments: [] };

  const statePath = options.statePath ?? defaultStatePath();
  const state = readState(statePath);
  const dedupKey = `${sessionId}:${mined.hash}`;
  if (state.captures[dedupKey]) return { ok: true, skipped: 'duplicate', sessionId, hash: mined.hash, moments: mined.moments };

  const learn = options.learn ?? ((await import('../server/handlers.ts')).handleLearn);
  const pattern = formatLearning(sessionId, mined.moments, options.transcriptPath);
  const concepts = ['huginn', 'auto-capture', 'session-jsonl', `session-${sessionId}`];
  const result: any = await learn(pattern, `huginn:auto-capture:${sessionId}`, concepts, 'huginn', undefined, options.cwd);

  state.captures[dedupKey] = {
    sessionId,
    hash: mined.hash,
    capturedAt: new Date().toISOString(),
    learningId: result?.id,
  };
  writeState(statePath, state);

  return {
    ok: true,
    sessionId,
    hash: mined.hash,
    learned: true,
    learningId: result?.id,
    sourceFile: result?.file,
    moments: mined.moments,
  };
}
