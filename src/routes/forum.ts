/**
 * Forum Routes — /api/threads, /api/thread, /api/thread/:id, /api/thread/:id/status
 */

import type { Hono } from 'hono';
import {
  handleThreadMessage,
  listThreads,
  getFullThread,
  getMessages,
  updateThreadStatus
} from '../forum/handler.ts';

export function registerForumRoutes(app: Hono) {
  // List threads
  app.get('/api/threads', (c) => {
    const status = c.req.query('status') as any;
    const limit = parseInt(c.req.query('limit') || '20');
    const offset = parseInt(c.req.query('offset') || '0');

    const threadList = listThreads({ status, limit, offset });
    return c.json({
      threads: threadList.threads.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        message_count: getMessages(t.id).length,
        created_at: new Date(t.createdAt).toISOString(),
        issue_url: t.issueUrl
      })),
      total: threadList.total
    });
  });

  // Create thread / send message
  app.post('/api/thread', async (c) => {
    try {
      const data = await c.req.json();
      if (!data.message) {
        return c.json({ error: 'Missing required field: message' }, 400);
      }
      const result = await handleThreadMessage({
        message: data.message,
        threadId: data.thread_id,
        title: data.title,
        role: data.role || 'human'
      });
      return c.json({
        thread_id: result.threadId,
        message_id: result.messageId,
        status: result.status,
        oracle_response: result.oracleResponse,
        issue_url: result.issueUrl
      });
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  });

  // Get thread by ID
  app.get('/api/thread/:id', (c) => {
    const threadId = parseInt(c.req.param('id'), 10);
    if (isNaN(threadId)) {
      return c.json({ error: 'Invalid thread ID' }, 400);
    }

    const threadData = getFullThread(threadId);
    if (!threadData) {
      return c.json({ error: 'Thread not found' }, 404);
    }

    return c.json({
      thread: {
        id: threadData.thread.id,
        title: threadData.thread.title,
        status: threadData.thread.status,
        created_at: new Date(threadData.thread.createdAt).toISOString(),
        issue_url: threadData.thread.issueUrl
      },
      messages: threadData.messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        author: m.author,
        principles_found: m.principlesFound,
        patterns_found: m.patternsFound,
        created_at: new Date(m.createdAt).toISOString()
      }))
    });
  });

  // Update thread status
  app.patch('/api/thread/:id/status', async (c) => {
    const threadId = parseInt(c.req.param('id'), 10);
    try {
      const data = await c.req.json();
      if (!data.status) {
        return c.json({ error: 'Missing required field: status' }, 400);
      }
      updateThreadStatus(threadId, data.status);
      return c.json({ success: true, thread_id: threadId, status: data.status });
    } catch (e) {
      return c.json({ error: 'Invalid JSON' }, 400);
    }
  });
}
