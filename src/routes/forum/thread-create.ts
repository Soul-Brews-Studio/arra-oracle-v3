import { Elysia } from 'elysia';
import { handleThreadMessage } from '../../forum/handler.ts';
import { optionalThreadId, parseMessageRole, threadCreateBody, trimmedString } from './model.ts';

export const threadCreateRoute = new Elysia().post('/api/thread', async ({ body, set }) => {
  try {
    const data = body as any;
    const message = trimmedString(data.message);
    if (!message) {
      set.status = 400;
      return { error: 'Missing required field: message' };
    }
    const threadId = optionalThreadId(data.thread_id);
    if (threadId === null) {
      set.status = 400;
      return { error: 'Invalid thread_id' };
    }
    const role = parseMessageRole(data.role);
    if (role === null) {
      set.status = 400;
      return { error: 'Invalid role (human|oracle|claude)' };
    }
    const result = await handleThreadMessage({
      message,
      threadId,
      title: trimmedString(data.title) ?? undefined,
      role: role || 'human',
    });
    return {
      thread_id: result.threadId,
      message_id: result.messageId,
      status: result.status,
      oracle_response: result.oracleResponse,
      issue_url: result.issueUrl,
    };
  } catch (error) {
    set.status = error instanceof Error && /Thread \d+ not found/.test(error.message) ? 404 : 500;
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}, {
  body: threadCreateBody,
  detail: {
    tags: ['forum'],
    menu: { group: 'hidden' },
    summary: 'Post a message to a forum thread',
  },
});
