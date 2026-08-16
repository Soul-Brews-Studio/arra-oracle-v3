/**
 * MCP tools over the jsonl-lens session corpus.
 *
 * The Oracle can search documents; it could not search **the conversations that produced them**.
 * These three tools close that, read-only. Access keys are session id and timestamp.
 *
 * Every tool degrades rather than throws when no corpus is present — `available: false` plus a
 * reason naming how to produce one. A machine without the export loses session search and
 * nothing else.
 */
import type { ToolContext, ToolResponse } from './types.ts';

const text = (payload: unknown, isError = false): ToolResponse => ({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

const INCLUDE_TOOLS_DESC =
  'Include tool calls (default false). Tool calls are 50% of rows but 69% of the text, and are ' +
  'mostly JSON — but they carry exact commands and file paths, so enable this for "which session ' +
  'ran X" or "who touched file Y" rather than for "what did we decide".';

export const sessionListToolDef = {
  name: 'oracle_session_list',
  description:
    'List recorded sessions from the jsonl-lens corpus, newest first, with turn counts. Use to ' +
    'find a session id before reading or searching it.',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Filter by project, e.g. "Soul-Brews-Studio/arra-oracle-v3"' },
      since: { type: 'string', description: 'ISO timestamp; only sessions modified at or after it' },
      limit: { type: 'number', description: 'Max sessions (default 40, max 200)', default: 40 },
    },
  },
};

export const sessionGetToolDef = {
  name: 'oracle_session_get',
  description:
    'Read the conversation of one session in order, by session id. Returns human/assistant/' +
    'thinking turns; tool calls are excluded unless includeTools is set.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session id from oracle_session_list' },
      limit: { type: 'number', description: 'Max turns (default 100, max 200)', default: 100 },
      offset: { type: 'number', description: 'Skip this many turns — page through a long session', default: 0 },
      includeTools: { type: 'boolean', description: INCLUDE_TOOLS_DESC, default: false },
    },
    required: ['sessionId'],
  },
};

export const sessionSearchToolDef = {
  name: 'oracle_session_search',
  description:
    'Search what was actually said across all recorded sessions. Answers "when did we decide X", ' +
    '"what did we say about Y" — questions whose answer lived in a conversation and never became ' +
    'a document. Each hit carries its session id and timestamp.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Text to find in conversation turns' },
      project: { type: 'string', description: 'Restrict to one project' },
      from: { type: 'string', description: 'ISO timestamp lower bound. NOTE: corpus timestamps are currently shifted +7h and labelled Z (jsonl-lens#1), so absolute windows are offset by that much until the exporter is fixed.' },
      to: { type: 'string', description: 'ISO timestamp upper bound. Same +7h caveat as `from`.' },
      limit: { type: 'number', description: 'Max hits (default 50, max 200)', default: 50 },
      includeTools: { type: 'boolean', description: INCLUDE_TOOLS_DESC, default: false },
    },
    required: ['query'],
  },
};

interface ListInput { project?: string; since?: string; limit?: number }
interface GetInput { sessionId?: string; limit?: number; offset?: number; includeTools?: boolean }
interface SearchInput { query?: string; project?: string; from?: string; to?: string; limit?: number; includeTools?: boolean }

/** Shared unavailable payload so every tool reports the same, actionable reason. */
async function unavailable() {
  const { lensStatus } = await import('../sessions/lens.ts');
  const status = lensStatus();
  return status.available ? null : text({ success: false, ...status }, true);
}

export async function handleSessionList(_ctx: ToolContext, input: ListInput = {}): Promise<ToolResponse> {
  const down = await unavailable();
  if (down) return down;
  const { listSessions } = await import('../sessions/query.ts');
  const { sessions } = listSessions(input ?? {});
  return text({ success: true, available: true, count: sessions.length, sessions });
}

export async function handleSessionGet(_ctx: ToolContext, input: GetInput = {}): Promise<ToolResponse> {
  if (!input?.sessionId?.trim()) {
    return text({ success: false, error: 'oracle_session_get requires sessionId' }, true);
  }
  const down = await unavailable();
  if (down) return down;
  const { beatsForSession } = await import('../sessions/query.ts');
  const { beats } = beatsForSession(input.sessionId.trim(), input);
  return text({ success: true, available: true, sessionId: input.sessionId.trim(), count: beats.length, turns: beats });
}

export async function handleSessionSearch(_ctx: ToolContext, input: SearchInput = {}): Promise<ToolResponse> {
  if (!input?.query?.trim()) {
    return text({ success: false, error: 'oracle_session_search requires query' }, true);
  }
  const down = await unavailable();
  if (down) return down;
  const { searchBeats } = await import('../sessions/query.ts');
  const { beats } = searchBeats(input.query.trim(), input);
  return text({
    success: true,
    available: true,
    query: input.query.trim(),
    includedTools: input.includeTools ?? false,
    count: beats.length,
    hits: beats,
  });
}
