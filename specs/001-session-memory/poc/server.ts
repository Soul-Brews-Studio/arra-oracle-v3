/**
 * lens-curator — proof that a 1-page app can run this service.
 *
 * Demonstrates the two-database design against REAL data:
 *   READ-ONLY  /opt/data/.lens/all.db   2.68 GB, 6,024 sessions, 1.03M beats  (never written to)
 *   READ-WRITE ./curator.db             small sidecar: summaries + log + supersession
 *
 * The point being proved: the huge corpus stays untouched and un-backed-up, while the flag,
 * the author, the log and the supersession chain live in a file small enough to back up freely.
 */
import { Database } from 'bun:sqlite';

const LENS = process.env.LENS_DB ?? '/opt/data/.lens/all.db';
const SIDE = process.env.CURATOR_DB ?? `${import.meta.dir}/curator.db`;
const PORT = Number(process.env.PORT ?? 47950);

const lens = new Database(LENS, { readonly: true });
const side = new Database(SIDE, { create: true });

// Sidecar schema — mirrors the shape arra-oracle already uses for supersession
// (superseded_by / superseded_at / superseded_reason + a log table), so the real
// implementation can reuse src/routes/supersede and oracle_supersede unchanged.
side.run(`
  CREATE TABLE IF NOT EXISTS summaries (
    id                TEXT PRIMARY KEY,
    session_id        TEXT NOT NULL,
    summary           TEXT NOT NULL,
    created_by        TEXT NOT NULL,          -- who: model id / agent identity / human
    created_at        INTEGER NOT NULL,
    superseded_by     TEXT,                   -- points at a newer summaries.id
    superseded_at     INTEGER,
    superseded_reason TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id);
  CREATE INDEX IF NOT EXISTS idx_summaries_active  ON summaries(session_id, superseded_at);
  CREATE TABLE IF NOT EXISTS summary_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT NOT NULL,
    summary_id   TEXT,
    action       TEXT NOT NULL,               -- created | superseded
    actor        TEXT NOT NULL,
    reason       TEXT,
    at           INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_summary_log_session ON summary_log(session_id);
`);

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

/** Sessions with their live (non-superseded) summary, if any. */
function listSessions(limit = 40) {
  const rows = lens
    .query(
      `SELECT s.id, s.project, s.created, s.modified,
              (SELECT COUNT(*) FROM beats b WHERE b.session_id = s.id) AS beats
         FROM sessions s ORDER BY s.modified DESC LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>;

  const live = side
    .query(
      `SELECT session_id, id, summary, created_by, created_at
         FROM summaries WHERE superseded_at IS NULL`,
    )
    .all() as Array<Record<string, unknown>>;
  const bySession = new Map(live.map((r) => [r.session_id as string, r]));

  return rows.map((r) => {
    const sum = bySession.get(r.id as string);
    return { ...r, summarized: Boolean(sum), summary: sum ?? null };
  });
}

function sessionDetail(id: string) {
  const session = lens.query(`SELECT * FROM sessions WHERE id = ?`).get(id);
  if (!session) return null;
  const beats = lens
    .query(`SELECT seq, ts, who, substr(what, 1, 600) AS what FROM beats WHERE session_id = ? ORDER BY seq LIMIT 200`)
    .all(id);
  const history = side
    .query(`SELECT * FROM summaries WHERE session_id = ? ORDER BY created_at DESC`)
    .all(id);
  const log = side
    .query(`SELECT * FROM summary_log WHERE session_id = ? ORDER BY at DESC LIMIT 50`)
    .all(id);
  return { session, beats, history, log };
}

/** Writing a new summary supersedes the previous live one — never deletes it. */
function putSummary(sessionId: string, summary: string, actor: string, reason?: string) {
  const now = Date.now();
  const id = `sum_${sessionId.slice(0, 8)}_${now}`;
  const prev = side
    .query(`SELECT id FROM summaries WHERE session_id = ? AND superseded_at IS NULL`)
    .get(sessionId) as { id: string } | null;

  if (prev) {
    side
      .query(`UPDATE summaries SET superseded_by = ?, superseded_at = ?, superseded_reason = ? WHERE id = ?`)
      .run(id, now, reason ?? 're-summarized', prev.id);
    side
      .query(`INSERT INTO summary_log (session_id, summary_id, action, actor, reason, at) VALUES (?,?,?,?,?,?)`)
      .run(sessionId, prev.id, 'superseded', actor, reason ?? 're-summarized', now);
  }
  side
    .query(`INSERT INTO summaries (id, session_id, summary, created_by, created_at) VALUES (?,?,?,?,?)`)
    .run(id, sessionId, summary, actor, now);
  side
    .query(`INSERT INTO summary_log (session_id, summary_id, action, actor, reason, at) VALUES (?,?,?,?,?,?)`)
    .run(sessionId, id, 'created', actor, reason ?? null, now);
  return { id, supersededPrevious: prev?.id ?? null };
}

const HTML = await Bun.file(`${import.meta.dir}/index.html`).text();

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    if (url.pathname === '/') return new Response(HTML, { headers: { 'content-type': 'text/html' } });

    if (url.pathname === '/api/stats') {
      const s = lens.query(`SELECT COUNT(*) n FROM sessions`).get() as { n: number };
      const b = lens.query(`SELECT COUNT(*) n FROM beats`).get() as { n: number };
      const d = side.query(`SELECT COUNT(*) n FROM summaries WHERE superseded_at IS NULL`).get() as { n: number };
      return json({ sessions: s.n, beats: b.n, summarized: d.n }, 200);
    }
    if (url.pathname === '/api/sessions') return json(listSessions(Number(url.searchParams.get('limit') ?? 40)));
    if (url.pathname.startsWith('/api/session/')) {
      const detail = sessionDetail(decodeURIComponent(url.pathname.split('/api/session/')[1]!));
      return detail ? json(detail) : json({ error: 'not found' }, 404);
    }
    if (url.pathname === '/api/summarize' && req.method === 'POST') {
      const body = (await req.json()) as { sessionId: string; summary: string; actor: string; reason?: string };
      return json(putSummary(body.sessionId, body.summary, body.actor, body.reason));
    }
    return json({ error: 'not found' }, 404);
  },
});

console.log(`lens-curator → http://localhost:${PORT}`);
console.log(`  read-only : ${LENS}`);
console.log(`  read-write: ${SIDE}`);
