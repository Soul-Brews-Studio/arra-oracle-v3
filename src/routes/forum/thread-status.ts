import { Elysia } from 'elysia';
import { updateThreadStatus } from '../../forum/handler.ts';
import { parseThreadId, parseThreadStatus, threadIdParam, threadStatusBody } from './model.ts';

export const threadStatusRoute = new Elysia().patch('/api/thread/:id/status', async ({ params, body, set }) => {
  const threadId = parseThreadId(params.id);
  if (!threadId) {
    set.status = 400;
    return { error: 'Invalid thread ID' };
  }
  try {
    const data = body as any;
    const status = parseThreadStatus(data.status);
    if (status === undefined) {
      set.status = 400;
      return { error: 'Missing required field: status' };
    }
    if (status === null) {
      set.status = 400;
      return { error: 'Invalid status (active|answered|pending|closed)' };
    }
    if (!updateThreadStatus(threadId, status)) {
      set.status = 404;
      return { error: 'Thread not found' };
    }
    return { success: true, thread_id: threadId, status };
  } catch (e) {
    set.status = 400;
    return { error: 'Invalid JSON' };
  }
}, {
  params: threadIdParam,
  body: threadStatusBody,
  detail: {
    tags: ['forum'],
    menu: { group: 'hidden' },
    summary: 'Update a thread status',
  },
});
