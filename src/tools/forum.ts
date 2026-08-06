/**
 * Oracle Forum Tool Handlers
 *
 * Thin wrappers around forum/handler.ts — these don't need ToolContext
 * since forum handlers use their own module-scoped DB.
 */

import type { ToolResponse } from './types.ts';

type ForumHandlerModule = typeof import('../forum/handler.ts');
let forumHandlerModule: ForumHandlerModule | null = null;
async function loadForumHandler(): Promise<ForumHandlerModule> {
  if (!forumHandlerModule) {
    forumHandlerModule = await import('../forum/handler.ts');
  }
  return forumHandlerModule;
}

// ============================================================================
// Input interfaces
// ============================================================================

export interface OracleThreadInput {
  message: string;
  threadId?: number;
  title?: string;
  role?: 'human' | 'claude';
  model?: string;
  /**
   * When sending a message to an existing thread whose status is 'closed',
   * the call is rejected unless reopen is explicitly true. Default false.
   * Prevents accidentally re-opening closed threads on continuation calls.
   */
  reopen?: boolean;
}

export interface OracleThreadsInput {
  status?: 'active' | 'answered' | 'pending' | 'closed';
  limit?: number;
  offset?: number;
}

export interface OracleThreadReadInput {
  threadId: number;
  limit?: number;
}

export interface OracleThreadUpdateInput {
  threadId: number;
  status?: 'active' | 'closed' | 'answered' | 'pending';
}

// ============================================================================
// Tool definitions
// ============================================================================

export const threadToolDef = {
  name: 'oracle_thread',
  description: 'Send a message to an Oracle discussion thread. Creates a new thread or continues an existing one. Oracle auto-responds from knowledge base. Use for multi-turn consultations.',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Your question or message' },
      threadId: { type: 'number', description: 'Thread ID to continue (omit to create new thread)' },
      title: { type: 'string', description: 'Title for new thread (defaults to first 50 chars of message)' },
      role: { type: 'string', enum: ['human', 'claude'], description: 'Who is sending (default: human)', default: 'human' },
      model: { type: 'string', description: 'Model name for Claude calls (e.g., "opus", "sonnet")' },
      reopen: { type: 'boolean', description: 'When threadId points to a closed thread, must pass reopen=true to add a new message (otherwise rejected). Defaults to false.', default: false },
    },
    required: ['message']
  }
};

export const threadsToolDef = {
  name: 'oracle_threads',
  description: 'List Oracle discussion threads. Filter by status to find pending questions or active discussions.',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['active', 'answered', 'pending', 'closed'], description: 'Filter by thread status' },
      limit: { type: 'number', description: 'Maximum threads to return (default: 20)', default: 20 },
      offset: { type: 'number', description: 'Pagination offset', default: 0 },
    },
    required: []
  }
};

export const threadReadToolDef = {
  name: 'oracle_thread_read',
  description: 'Read full message history from a thread. Use to review context before continuing a conversation.',
  inputSchema: {
    type: 'object',
    properties: {
      threadId: { type: 'number', description: 'Thread ID to read' },
      limit: { type: 'number', description: 'Maximum messages to return (default: all)' },
    },
    required: ['threadId']
  }
};

export const threadUpdateToolDef = {
  name: 'oracle_thread_update',
  description: 'Update thread status. Use to close, reopen, or mark threads as answered/pending.',
  inputSchema: {
    type: 'object',
    properties: {
      threadId: { type: 'number', description: 'Thread ID to update' },
      status: { type: 'string', enum: ['active', 'closed', 'answered', 'pending'], description: 'New status for the thread' },
    },
    required: ['threadId', 'status']
  }
};

/** All forum tool definitions for ListTools */
export const forumToolDefs = [
  threadToolDef,
  threadsToolDef,
  threadReadToolDef,
  threadUpdateToolDef,
];

// ============================================================================
// Handlers
// ============================================================================

export async function handleThread(input: OracleThreadInput): Promise<ToolResponse> {
  // Null-guard: MCP clients sometimes call with no args. Show usage instead of crashing.
  if (input == null || typeof input !== 'object') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: "arra_thread requires field 'message' (non-empty string).",
          usage: "arra_thread({ message: 'your question or message', threadId?: number, title?: 'optional title' })",
          tip: "To list threads, use arra_threads(). To read a specific one, use arra_thread_read(threadId)."
        }, null, 2)
      }],
      isError: true
    };
  }

  const message = (input as { message?: unknown }).message;
  if (typeof message !== 'string' || message.trim().length === 0) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: "arra_thread requires field 'message' (non-empty string).",
          received: message === undefined ? 'undefined' : typeof message,
          usage: "arra_thread({ message: 'your question...', threadId?: number, title?: 'optional title' })"
        }, null, 2)
      }],
      isError: true
    };
  }

  // Closed-thread gate (iter2 bug #6): if threadId points to an existing thread
  // whose status is 'closed', reject unless reopen=true is explicitly passed.
  // Prevents handleThreadMessage's unconditional status-flip from silently
  // re-opening closed threads on continuation calls.
  if (typeof input.threadId === 'number') {
    const { getFullThread } = await loadForumHandler();
    const existing = getFullThread(input.threadId);
    if (existing && existing.thread.status === 'closed' && input.reopen !== true) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `Thread ${input.threadId} is closed. Pass reopen=true to add a new message and re-open it.`,
            received: { threadId: input.threadId, reopen: input.reopen ?? false, currentStatus: 'closed' },
            tip: "Either pass reopen=true on this call, or arra_thread_update({threadId, status:'active'}) first."
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  const { handleThreadMessage } = await loadForumHandler();
  const result = await handleThreadMessage({
    message: input.message,
    threadId: input.threadId,
    title: input.title,
    role: input.role || 'claude',
    model: input.model,
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        thread_id: result.threadId,
        message_id: result.messageId,
        status: result.status,
        oracle_response: result.oracleResponse ? {
          content: result.oracleResponse.content,
          principles_found: result.oracleResponse.principlesFound,
          patterns_found: result.oracleResponse.patternsFound,
        } : null,
        issue_url: result.issueUrl,
      }, null, 2)
    }]
  };
}

export async function handleThreads(input: OracleThreadsInput): Promise<ToolResponse> {
  const { listThreads, getMessages } = await loadForumHandler();
  const result = listThreads({
    status: input.status as any,
    limit: input.limit || 20,
    offset: input.offset || 0,
  });

  const threadsWithCounts = result.threads.map(thread => {
    const messages = getMessages(thread.id);
    const lastMessage = messages[messages.length - 1];
    return {
      id: thread.id,
      title: thread.title,
      status: thread.status,
      message_count: messages.length,
      last_message: lastMessage?.content.substring(0, 100) || '',
      created_at: new Date(thread.createdAt).toISOString(),
      issue_url: thread.issueUrl,
    };
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ threads: threadsWithCounts, total: result.total }, null, 2)
    }]
  };
}

export async function handleThreadRead(input: OracleThreadReadInput): Promise<ToolResponse> {
  if (input == null || typeof input !== 'object' || typeof input.threadId !== 'number') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: "arra_thread_read requires field 'threadId' (number).",
          received: input == null ? 'undefined' : typeof (input as any).threadId,
          usage: "arra_thread_read({ threadId: 528, limit?: 10 })",
          tip: "List recent threads with arra_threads()."
        }, null, 2)
      }],
      isError: true
    };
  }
  const { getFullThread } = await loadForumHandler();
  const threadData = getFullThread(input.threadId);
  if (!threadData) throw new Error(`Thread ${input.threadId} not found`);

  let messages = threadData.messages.map(m => ({
    id: m.id,
    role: m.role,
    author: m.author,
    content: m.content,
    timestamp: new Date(m.createdAt).toISOString(),
  }));

  if (input.limit && input.limit > 0) {
    messages = messages.slice(-input.limit);
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        thread_id: threadData.thread.id,
        title: threadData.thread.title,
        status: threadData.thread.status,
        message_count: threadData.messages.length,
        messages,
      }, null, 2)
    }]
  };
}

export async function handleThreadUpdate(input: OracleThreadUpdateInput): Promise<ToolResponse> {
  if (input == null || typeof input !== 'object' || typeof input.threadId !== 'number') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: "arra_thread_update requires field 'threadId' (number).",
          received: input == null ? 'undefined' : typeof (input as any).threadId,
          usage: "arra_thread_update({ threadId: 528, status: 'closed' })"
        }, null, 2)
      }],
      isError: true
    };
  }
  const ALLOWED_STATUSES = ['active', 'closed', 'answered', 'pending'] as const;
  if (!input.status || !ALLOWED_STATUSES.includes(input.status as any)) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: "arra_thread_update requires field 'status' to be one of: active, closed, answered, pending.",
          received: input.status === undefined ? 'undefined' : JSON.stringify(input.status),
          allowed: ALLOWED_STATUSES,
          usage: "arra_thread_update({ threadId: 528, status: 'closed' })"
        }, null, 2)
      }],
      isError: true
    };
  }

  const { updateThreadStatus, getFullThread } = await loadForumHandler();
  updateThreadStatus(input.threadId, input.status);
  const threadData = getFullThread(input.threadId);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        thread_id: input.threadId,
        status: input.status,
        title: threadData?.thread.title,
      }, null, 2)
    }]
  };
}
