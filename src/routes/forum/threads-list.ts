import { Elysia } from 'elysia';
import { listThreads, getMessages } from '../../forum/handler.ts';
import { threadsQuery } from './model.ts';

export const threadsListRoute = new Elysia().get('/api/threads', ({ query }) => {
  const status = query.status as any;
  const limit = parseInt(query.limit || '20');
  const offset = parseInt(query.offset || '0');

  const threadList = listThreads({ status, limit, offset });
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
