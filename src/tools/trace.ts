/**
 * Oracle Trace Tool Handlers
 *
 * Thin wrappers around trace/handler.ts — these don't need ToolContext
 * since trace handlers use their own module-scoped DB.
 */

import {
  createTrace,
  getTrace,
  listTraces,
  getTraceChain,
  linkTraces,
  unlinkTraces,
  getTraceLinkedChain,
} from '../trace/handler.ts';

import type {
  CreateTraceInput,
  ListTracesInput,
  GetTraceInput,
} from '../trace/types.ts';

import type { ToolResponse } from './types.ts';

// ============================================================================
// Tool definitions
// ============================================================================

export const traceToolDef = {
  name: 'oracle_trace',
  description: 'Log a trace session with dig points (files, commits, issues found). Use to capture /trace command results for future exploration.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What was traced (required)' },
      queryType: { type: 'string', enum: ['general', 'project', 'pattern', 'evolution'], description: 'Type of trace query', default: 'general' },
      foundFiles: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, type: { type: 'string', enum: ['learning', 'retro', 'resonance', 'other'] }, matchReason: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] } } }, description: 'Files discovered' },
      foundCommits: { type: 'array', items: { type: 'object', properties: { hash: { type: 'string' }, shortHash: { type: 'string' }, date: { type: 'string' }, message: { type: 'string' } } }, description: 'Commits discovered' },
      foundIssues: { type: 'array', items: { type: 'object', properties: { number: { type: 'number' }, title: { type: 'string' }, state: { type: 'string', enum: ['open', 'closed'] }, url: { type: 'string' } } }, description: 'GitHub issues discovered' },
      foundRetrospectives: { type: 'array', items: { type: 'string' }, description: 'Retrospective file paths' },
      foundLearnings: { type: 'array', items: { type: 'string' }, description: 'Learning file paths' },
      scope: { type: 'string', enum: ['project', 'cross-project', 'human'], description: 'Trace scope. project=single repo, cross-project=spans repos, human=about the person' },
      parentTraceId: { type: 'string', description: 'Parent trace ID if this is a dig from another trace' },
      project: { type: 'string', description: 'Project context (ghq format)' },
      agentCount: { type: 'number', description: 'Number of agents used in trace' },
      durationMs: { type: 'number', description: 'How long trace took in milliseconds' },
    },
    required: ['query']
  }
};

export const traceListToolDef = {
  name: 'oracle_trace_list',
  description: 'List recent traces with optional filters. Returns trace summaries for browsing.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Filter by query content' },
      project: { type: 'string', description: 'Filter by project' },
      status: { type: 'string', enum: ['raw', 'reviewed', 'distilling', 'distilled'], description: 'Filter by distillation status' },
      depth: { type: 'number', description: 'Filter by recursion depth (0 = top-level traces)' },
      limit: { type: 'number', description: 'Maximum traces to return', default: 20 },
      offset: { type: 'number', description: 'Pagination offset', default: 0 },
    }
  }
};

export const traceGetToolDef = {
  name: 'oracle_trace_get',
  description: 'Get full details of a specific trace including all dig points (files, commits, issues).',
  inputSchema: {
    type: 'object',
    properties: {
      traceId: { type: 'string', description: 'UUID of the trace' },
      includeChain: { type: 'boolean', description: 'Include parent/child trace chain', default: false },
    },
    required: ['traceId']
  }
};

export const traceLinkToolDef = {
  name: 'oracle_trace_link',
  description: 'Link two traces as a chain (prev \u2192 next). Creates bidirectional navigation without deleting anything. Use when agents create related traces that should be connected.',
  inputSchema: {
    type: 'object',
    properties: {
      prevTraceId: { type: 'string', description: 'UUID of the trace that comes first (will link forward)' },
      nextTraceId: { type: 'string', description: 'UUID of the trace that comes after (will link backward)' },
    },
    required: ['prevTraceId', 'nextTraceId']
  }
};

export const traceUnlinkToolDef = {
  name: 'oracle_trace_unlink',
  description: 'Remove a link between traces. Breaks the chain connection in the specified direction.',
  inputSchema: {
    type: 'object',
    properties: {
      traceId: { type: 'string', description: 'UUID of the trace to unlink from' },
      direction: { type: 'string', enum: ['prev', 'next'], description: 'Which direction to unlink (prev or next)' },
    },
    required: ['traceId', 'direction']
  }
};

export const traceChainToolDef = {
  name: 'oracle_trace_chain',
  description: 'Get the full linked chain for a trace. Returns all traces in the chain and the position of the requested trace.',
  inputSchema: {
    type: 'object',
    properties: {
      traceId: { type: 'string', description: 'UUID of any trace in the chain' },
    },
    required: ['traceId']
  }
};

/** All trace tool definitions for ListTools */
export const traceToolDefs = [
  traceToolDef,
  traceListToolDef,
  traceGetToolDef,
  traceLinkToolDef,
  traceUnlinkToolDef,
  traceChainToolDef,
];

// ============================================================================
// Handlers
// ============================================================================

export async function handleTrace(input: CreateTraceInput): Promise<ToolResponse> {
  if (input == null || typeof input !== 'object') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: "arra_trace requires field 'query' (non-empty string).",
          usage: "arra_trace({ query: 'what was traced', scope?: 'project'|'cross-project'|'human', queryType?: 'general'|'project'|'pattern'|'evolution' })",
          tip: "List recent traces with arra_trace_list()."
        }, null, 2)
      }],
      isError: true
    };
  }
  const q = (input as { query?: unknown }).query;
  if (typeof q !== 'string' || q.trim().length === 0) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: "arra_trace requires field 'query' (non-empty string).",
          received: q === undefined ? 'undefined' : typeof q,
          usage: "arra_trace({ query: 'what was traced', ... })"
        }, null, 2)
      }],
      isError: true
    };
  }
  const result = createTrace(input);
  console.error(`[MCP:TRACE] query="${input.query}" depth=${result.depth} digPoints=${result.summary.totalDigPoints}`);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: result.success,
        trace_id: result.traceId,
        depth: result.depth,
        summary: {
          file_count: result.summary.fileCount,
          commit_count: result.summary.commitCount,
          issue_count: result.summary.issueCount,
          total_dig_points: result.summary.totalDigPoints,
        },
        message: `Trace logged. Use oracle_trace_get with trace_id="${result.traceId}" to explore dig points.`
      }, null, 2)
    }]
  };
}

export async function handleTraceList(input: ListTracesInput): Promise<ToolResponse> {
  const result = listTraces(input);
  console.error(`[MCP:TRACE_LIST] found=${result.total} returned=${result.traces.length}`);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        traces: result.traces.map(t => ({
          trace_id: t.traceId,
          query: t.query,
          scope: t.scope,
          depth: t.depth,
          file_count: t.fileCount,
          commit_count: t.commitCount,
          issue_count: t.issueCount,
          status: t.status,
          has_awakening: t.hasAwakening,
          created_at: new Date(t.createdAt).toISOString(),
        })),
        total: result.total,
        has_more: result.hasMore,
      }, null, 2)
    }]
  };
}

export async function handleTraceGet(input: GetTraceInput): Promise<ToolResponse> {
  if (input == null || typeof input !== 'object' || typeof input.traceId !== 'string' || input.traceId.length === 0) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: "arra_trace_get requires field 'traceId' (UUID string).",
          received: input == null ? 'undefined' : typeof (input as any).traceId,
          usage: "arra_trace_get({ traceId: '6b381742-...', includeChain?: false })"
        }, null, 2)
      }],
      isError: true
    };
  }
  const trace = getTrace(input.traceId);
  if (!trace) throw new Error(`Trace ${input.traceId} not found`);

  console.error(`[MCP:TRACE_GET] id=${input.traceId} query="${trace.query}"`);

  let chain = undefined;
  if (input.includeChain) {
    chain = getTraceChain(input.traceId);
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        trace_id: trace.traceId,
        query: trace.query,
        query_type: trace.queryType,
        scope: trace.scope,
        depth: trace.depth,
        status: trace.status,
        found_files: trace.foundFiles,
        found_commits: trace.foundCommits,
        found_issues: trace.foundIssues,
        found_retrospectives: trace.foundRetrospectives,
        found_learnings: trace.foundLearnings,
        found_resonance: trace.foundResonance,
        file_count: trace.fileCount,
        commit_count: trace.commitCount,
        issue_count: trace.issueCount,
        parent_trace_id: trace.parentTraceId,
        child_trace_ids: trace.childTraceIds,
        prev_trace_id: trace.prevTraceId,
        next_trace_id: trace.nextTraceId,
        project: trace.project,
        agent_count: trace.agentCount,
        duration_ms: trace.durationMs,
        awakening: trace.awakening,
        distilled_to_id: trace.distilledToId,
        created_at: new Date(trace.createdAt).toISOString(),
        updated_at: new Date(trace.updatedAt).toISOString(),
        chain: chain ? {
          traces: chain.chain,
          total_depth: chain.totalDepth,
          has_awakening: chain.hasAwakening,
          awakening_trace_id: chain.awakeningTraceId,
        } : undefined,
      }, null, 2)
    }]
  };
}

export async function handleTraceLink(input: { prevTraceId: string; nextTraceId: string }): Promise<ToolResponse> {
  const result = linkTraces(input.prevTraceId, input.nextTraceId);
  if (!result.success) throw new Error(result.message);

  console.error(`[MCP:TRACE_LINK] ${input.prevTraceId} \u2192 ${input.nextTraceId}`);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        message: result.message,
        prev_trace: result.prevTrace ? {
          trace_id: result.prevTrace.traceId,
          query: result.prevTrace.query,
          next_trace_id: result.prevTrace.nextTraceId,
        } : undefined,
        next_trace: result.nextTrace ? {
          trace_id: result.nextTrace.traceId,
          query: result.nextTrace.query,
          prev_trace_id: result.nextTrace.prevTraceId,
        } : undefined,
      }, null, 2)
    }]
  };
}

export async function handleTraceUnlink(input: { traceId: string; direction: 'prev' | 'next' }): Promise<ToolResponse> {
  const result = unlinkTraces(input.traceId, input.direction);
  if (!result.success) throw new Error(result.message);

  console.error(`[MCP:TRACE_UNLINK] ${input.traceId} direction=${input.direction}`);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ success: true, message: result.message }, null, 2)
    }]
  };
}

export async function handleTraceChain(input: { traceId: string }): Promise<ToolResponse> {
  if (input == null || typeof input !== 'object' || typeof input.traceId !== 'string' || input.traceId.length === 0) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: "arra_trace_chain requires field 'traceId' (UUID string).",
          received: input == null ? 'undefined' : typeof (input as any).traceId,
          usage: "arra_trace_chain({ traceId: '6b381742-...' })",
          tip: "Pass any trace UUID in the chain to retrieve the full sequence."
        }, null, 2)
      }],
      isError: true
    };
  }
  const result = getTraceLinkedChain(input.traceId);
  console.error(`[MCP:TRACE_CHAIN] id=${input.traceId} chain_length=${result.chain.length} position=${result.position}`);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        chain: result.chain.map(t => ({
          trace_id: t.traceId,
          query: t.query,
          prev_trace_id: t.prevTraceId,
          next_trace_id: t.nextTraceId,
          created_at: new Date(t.createdAt).toISOString(),
        })),
        position: result.position,
        chain_length: result.chain.length,
      }, null, 2)
    }]
  };
}
