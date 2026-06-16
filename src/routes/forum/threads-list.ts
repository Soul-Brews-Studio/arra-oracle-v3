import { Elysia } from 'elysia';
import { listThreads, getMessages } from '../../forum/handler.ts';
import { parsePagination, parseThreadStatus, threadsQuery } from './model.ts';

export const threadsListRoute = new Elysia().get('/api/threads', ({ query, set }) => {
  const status = parseThreadStatus(query.status);
  if (status === null) {
    set.status = 400;
    return { error: 'Invalid status (active|answered|pending|closed)' };
  }
  const page = parsePagination(query);
  if ('error' in page) {
    set.status = 400;
    return { error: page.error };
  }

  const threadList = listThreads({ status, limit: page.limit, offset: page.offset });
  return {
    threads: threadList.threads.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      message_count: getMessages(t.id).length,
      created_at: new Date(t.createdAt).toISOString(),
      issue_url: t.issueUrl,
    })),
    total: threadList.total,
  };
}, {
  query: threadsQuery,
  detail: {
    tags: ['forum'],
    menu: { group: 'main', path: '/', order: 40 },
    summary: 'List forum threads',
  },
});
