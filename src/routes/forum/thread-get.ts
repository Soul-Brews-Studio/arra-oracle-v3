import { Elysia } from 'elysia';
import { getFullThread } from '../../forum/handler.ts';
import { parseThreadId, threadIdParam } from './model.ts';

export const threadGetRoute = new Elysia().get('/api/thread/:id', ({ params, set }) => {
  const threadId = parseThreadId(params.id);
  if (!threadId) {
    set.status = 400;
    return { error: 'Invalid thread ID' };
  }

  const threadData = getFullThread(threadId);
  if (!threadData) {
    set.status = 404;
    return { error: 'Thread not found' };
  }

  return {
    thread: {
      id: threadData.thread.id,
      title: threadData.thread.title,
      status: threadData.thread.status,
      created_at: new Date(threadData.thread.createdAt).toISOString(),
      issue_url: threadData.thread.issueUrl,
    },
    messages: threadData.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      author: m.author,
      principles_found: m.principlesFound,
      patterns_found: m.patternsFound,
      created_at: new Date(m.createdAt).toISOString(),
    })),
  };
}, {
  params: threadIdParam,
  detail: {
    tags: ['forum'],
    menu: { group: 'hidden' },
    summary: 'Get one forum thread',
  },
});
