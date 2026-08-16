/**
 * Queries over the read-only session corpus.
 *
 * Two facts from the real data shape everything here:
 *
 *  1. **A beat is not a turn.** Measured `who` distribution: tool 520,829 (50.5%) ·
 *     assistant 354,252 · human 135,574 · thinking 18,746 · system 2,166. Half the rows are
 *     tool-call JSON, so conversation queries exclude `tool` by default.
 *  2. **Tool calls are still worth searching, but for identifiers, not prose.** They out-match
 *     conversation ~2:1 on technical terms (`supersede` 2,016 vs 1,166) because they carry the
 *     exact commands and paths. So `includeTools` is opt-in and returns them as a distinct
 *     result class rather than blending them into prose relevance.
 *
 * Text matching is LIKE, deliberately. The corpus ships two indexes only
 * (`beats_session_idx`, `beats_project_idx`) and no FTS table; building one over 2.7 GB is a
 * separate decision with its own cost. Every query here is either session-scoped or
 * project-scoped or limited, so it rides an existing index.
 */
import { CONVERSATION_WHO, openLens } from './lens.ts';

export interface Beat {
  session_id: string;
  seq: number;
  ts: string;
  who: string;
  what: string;
  project?: string | null;
}

export interface SessionRow {
  id: string;
  project: string | null;
  created: string;
  modified: string;
  beats?: number;
}

const MAX_LIMIT = 200;
const clamp = (n: number | undefined, fallback: number) =>
  Math.max(1, Math.min(MAX_LIMIT, Math.floor(n ?? fallback)));

/** Truncate stored text so one huge Write payload cannot dominate a response. */
const SNIPPET = 600;

function whoFilter(includeTools: boolean): string {
  const list = includeTools
    ? [...CONVERSATION_WHO, 'tool']
    : [...CONVERSATION_WHO];
  return list.map((w) => `'${w}'`).join(',');
}

/** Turns of one session, in order. The session id is the stable key jsonl-lens exports. */
export function beatsForSession(
  sessionId: string,
  opts: { limit?: number; offset?: number; includeTools?: boolean } = {},
): { available: boolean; beats: Beat[] } {
  const db = openLens();
  if (!db) return { available: false, beats: [] };
  const limit = clamp(opts.limit, 100);
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const beats = db.query(
    `SELECT session_id, seq, ts, who, substr(what, 1, ${SNIPPET}) AS what
       FROM beats
      WHERE session_id = ? AND who IN (${whoFilter(opts.includeTools ?? false)})
      ORDER BY seq LIMIT ? OFFSET ?`,
  ).all(sessionId, limit, offset) as Beat[];
  return { available: true, beats };
}

/** Turns across all sessions inside a time window — the "what was happening on X" query. */
export function beatsInRange(
  from: string,
  to: string,
  opts: { project?: string; limit?: number; includeTools?: boolean } = {},
): { available: boolean; beats: Beat[] } {
  const db = openLens();
  if (!db) return { available: false, beats: [] };
  const limit = clamp(opts.limit, 100);
  const project = opts.project?.trim();
  const sql =
    `SELECT session_id, seq, ts, who, project, substr(what, 1, ${SNIPPET}) AS what
       FROM beats
      WHERE ts >= ? AND ts <= ? AND who IN (${whoFilter(opts.includeTools ?? false)})
      ${project ? 'AND project = ?' : ''}
      ORDER BY ts LIMIT ?`;
  const args = project ? [from, to, project, limit] : [from, to, limit];
  return { available: true, beats: db.query(sql).all(...args) as Beat[] };
}

/** Keyword search over conversation text; `includeTools` widens it to commands and paths. */
export function searchBeats(
  query: string,
  opts: { project?: string; from?: string; to?: string; limit?: number; includeTools?: boolean } = {},
): { available: boolean; beats: Beat[] } {
  const db = openLens();
  if (!db) return { available: false, beats: [] };
  const q = query.trim();
  if (!q) return { available: true, beats: [] };
  const limit = clamp(opts.limit, 50);
  const project = opts.project?.trim();
  const clauses = [`who IN (${whoFilter(opts.includeTools ?? false)})`, 'what LIKE ? ESCAPE \'\\\''];
  // `_` and `%` are LIKE wildcards and appear constantly in real identifiers (db:push, file_path).
  const needle = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const args: (string | number)[] = [needle];
  if (project) { clauses.push('project = ?'); args.push(project); }
  if (opts.from) { clauses.push('ts >= ?'); args.push(opts.from); }
  if (opts.to) { clauses.push('ts <= ?'); args.push(opts.to); }
  args.push(limit);
  const beats = db.query(
    `SELECT session_id, seq, ts, who, project, substr(what, 1, ${SNIPPET}) AS what
       FROM beats WHERE ${clauses.join(' AND ')} ORDER BY ts DESC LIMIT ?`,
  ).all(...args) as Beat[];
  return { available: true, beats };
}

/** Sessions, most recently modified first. */
export function listSessions(
  opts: { project?: string; since?: string; limit?: number } = {},
): { available: boolean; sessions: SessionRow[] } {
  const db = openLens();
  if (!db) return { available: false, sessions: [] };
  const limit = clamp(opts.limit, 40);
  const clauses: string[] = [];
  const args: (string | number)[] = [];
  if (opts.project?.trim()) { clauses.push('project = ?'); args.push(opts.project.trim()); }
  if (opts.since?.trim()) { clauses.push('modified >= ?'); args.push(opts.since.trim()); }
  args.push(limit);
  const sessions = db.query(
    `SELECT id, project, created, modified,
            (SELECT COUNT(*) FROM beats b WHERE b.session_id = s.id) AS beats
       FROM sessions s
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY modified DESC LIMIT ?`,
  ).all(...args) as SessionRow[];
  return { available: true, sessions };
}
