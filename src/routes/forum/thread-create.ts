import { Elysia } from 'elysia';
import { handleThreadMessage } from '../../forum/handler.ts';
import { threadCreateBody } from './model.ts';

export const threadCreateRoute = new Elysia().post('/api/thread', async ({ body, set }) => {
  try {
    const data = body as any;
    if (!data.message) {
      set.status = 400;
      return { error: 'Missing required field: message' };
    }
    const result = await handleThreadMessage({
      message: data.message,
      threadId: data.thread_id,
      title: data.title,
      role: data.role || 'human',
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
