/**
 * Read routes over the session corpus — the HTTP half of what MCP already exposes.
 *
 * `src/tools/sessions.ts` lets an AI search and read sessions; this lets a human do the same in a
 * browser, and adds the one thing MCP has no use for: **summary state**. Every session carries
 * whether it has been summarised, by whom, and whether that summary has been superseded, so the
 * web UI can show the queue of unsummarised work rather than making a person guess.
 *
 * ⚠️ Timestamps come from the corpus as-is. `jsonl-lens/src/export-turso.ts:62-63` adds 7h to a
 * UTC instant and re-serialises with `.toISOString()`, so every `ts` claims UTC while carrying
 * Bangkok local time (Soul-Brews-Studio/jsonl-lens#1). We do not silently correct it here — see
 * the reasoning in `src/sessions/query.ts` — but we do say so in the payload, so a UI cannot
 * present a shifted clock as authoritative without having been told.
 */
import { Elysia, t } from 'elysia';
import { lensStatus } from '../../sessions/lens.ts';
import { beatsForSession, listSessions, searchBeats } from '../../sessions/query.ts';
import { summaryDetail, summaryStates } from './summaries.ts';

const TZ_NOTE = 'ts values are +7h and mislabelled UTC upstream (jsonl-lens#1); ordering is self-consistent';

const UNAVAILABLE = {
  available: false,
  error: 'Session corpus is not available on this host.',
  hint: 'Set ORACLE_LENS_DB, or run `just export-turso` in jsonl-lens to build /opt/data/.lens/all.db',
};

const asBool = (v: string | undefined) => v === 'true' || v === '1';
const asNum = (v: string | undefined) => (v === undefined ? undefined : Number(v));

export const sessionsReadRoutes = new Elysia()
  /** Is the corpus mounted at all, and how big is it? Lets the UI render a real empty state. */
  .get('/api/lens/status', () => {
    const status = lensStatus();
    return { ...status, note: status.available ? TZ_NOTE : undefined };
  })

  /** Keyword search. `includeTools` widens to tool parameters — commands and paths. */
  .get('/api/lens/search', ({ query, set }) => {
    const q = (query.q ?? '').trim();
    if (!q) {
      set.status = 400;
      return { error: 'Missing required query parameter: q' };
    }
    const result = searchBeats(q, {
      project: query.project,
      limit: asNum(query.limit),
      includeTools: asBool(query.includeTools),
    });
    if (!result.available) {
      set.status = 503;
      return UNAVAILABLE;
    }
    return {
      available: true,
      query: q,
      includeTools: asBool(query.includeTools),
      count: result.beats.length,
      hits: result.beats,
      note: TZ_NOTE,
    };
  }, {
    query: t.Object({
      q: t.Optional(t.String()),
      project: t.Optional(t.String()),
      limit: t.Optional(t.String()),
      includeTools: t.Optional(t.String()),
    }),
  })

  /** Sessions, newest first, each tagged with its summary state. */
  .get('/api/lens/sessions', ({ query, set }) => {
    const result = listSessions({
      project: query.project,
      since: query.since,
      limit: asNum(query.limit),
    });
    if (!result.available) {
      set.status = 503;
      return UNAVAILABLE;
    }
    const states = summaryStates(result.sessions.map((s) => s.id));
    const sessions = result.sessions.map((s) => ({ ...s, summary: states.get(s.id) ?? null }));
    return {
      available: true,
      count: sessions.length,
      summarized: sessions.filter((s) => s.summary).length,
      sessions,
      note: TZ_NOTE,
    };
  }, {
    query: t.Object({
      project: t.Optional(t.String()),
      since: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })

  /** One session's turns, plus its summary if an AI has written one. */
  .get('/api/lens/sessions/:id', ({ params, query, set }) => {
    const result = beatsForSession(params.id, {
      limit: asNum(query.limit),
      offset: asNum(query.offset),
      includeTools: asBool(query.includeTools),
    });
    if (!result.available) {
      set.status = 503;
      return UNAVAILABLE;
    }
    return {
      available: true,
      sessionId: params.id,
      count: result.beats.length,
      turns: result.beats,
      summary: summaryDetail(params.id),
      note: TZ_NOTE,
    };
  }, {
    query: t.Object({
      limit: t.Optional(t.String()),
      offset: t.Optional(t.String()),
      includeTools: t.Optional(t.String()),
    }),
  });
