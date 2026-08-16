/**
 * MCP write path for session summaries.
 *
 * `POST /api/session/:id/summary` has existed and worked for some time
 * (`src/routes/sessions/summary.ts`, mounted at `src/server.ts:188`): it stores a summary as an
 * ordinary `oracle_document` with id `session-summary_<sid>` and `createdBy: 'session_summary'`,
 * wiring FTS, entity links, document pointers and the learn log. Measured on the live corpus:
 * **0 rows** with that `created_by`. Live code, never called — because the only caller would be an
 * AI, and an AI reaches this Oracle over MCP, where no tool existed.
 *
 * This is that tool. It adds no storage and no schema: a summary was already an oracle_document,
 * so supersession, tenant scoping, FTS and the web UI all apply to it for free.
 *
 * On "who": `ToolContext` carries no principal (`src/tools/types.ts:15-23`), so the author cannot
 * be verified at this layer — it is a *claim* made by the caller. `author` is therefore a required
 * argument rather than something inferred, so the record says who claimed authorship instead of
 * silently recording "unknown".
 */
import type { ToolContext, ToolResponse } from './types.ts';

const text = (payload: unknown, isError = false): ToolResponse => ({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

export const sessionSummarizeToolDef = {
  name: 'oracle_session_summarize',
  description:
    'Write a summary of a session back to the Oracle, so a human can read it in the web UI and ' +
    'search finds it later. Stored as an ordinary document, so it is searchable and supersedable ' +
    'like any other. Read the session first with oracle_session_get.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'The session being summarised, e.g. from oracle_session_list',
      },
      summary: {
        type: 'string',
        description: 'The summary text. Write what a person would need to know without reading the session.',
      },
      author: {
        type: 'string',
        description:
          'Who is writing this — your model or agent name, e.g. "claude-opus-5". Required, and ' +
          'recorded as a claim: this layer cannot verify caller identity, so an unattributed ' +
          'summary would be worse than an attributed one.',
      },
    },
    required: ['sessionId', 'summary', 'author'],
  },
};

interface SummarizeInput {
  sessionId?: string;
  summary?: string;
  author?: string;
}

export async function handleSessionSummarize(
  _ctx: ToolContext,
  input: SummarizeInput = {},
): Promise<ToolResponse> {
  const sessionId = input?.sessionId?.trim();
  const summary = input?.summary?.trim();
  const author = input?.author?.trim();

  if (!sessionId) return text({ success: false, error: 'oracle_session_summarize requires sessionId' }, true);
  if (!summary) return text({ success: false, error: 'oracle_session_summarize requires summary' }, true);
  if (!author) {
    return text({
      success: false,
      error: 'oracle_session_summarize requires author — name your model or agent. Provenance is not inferable here.',
    }, true);
  }

  try {
    const { persistSessionSummary } = await import('../routes/sessions/store.ts');
    const result = persistSessionSummary(sessionId, summary, author);
    return text({
      success: true,
      sessionId,
      author,
      documentId: result.learning_id,
      sourceFile: result.source_file,
      tenantId: result.tenant_id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A summary already existing is an ordinary outcome, not a crash. Say so plainly, and say
    // what to do about it, rather than returning a raw filesystem error.
    if (message.startsWith('File already exists:')) {
      return text({
        success: false,
        sessionId,
        error: `A summary already exists for session ${sessionId}.`,
        hint: 'Replacing a summary is a supersession, not an overwrite — supersede the existing document with arra_supersede so the previous summary stays readable.',
      }, true);
    }
    return text({ success: false, sessionId, error: message }, true);
  }
}
