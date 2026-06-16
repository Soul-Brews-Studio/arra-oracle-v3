import { Elysia } from 'elysia';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FEED_LOG } from '../../config.ts';
import { formatLocalFeedLine } from '../../feed/events.ts';
import { tenantDataPath, tenantIdForWrite } from '../../middleware/tenant.ts';
import { CreateFeedBody } from './model.ts';

export const createFeedRoute = new Elysia().post('/', async ({ body, set }) => {
  try {
    const { oracle, event, project, session_id, message } = body;

    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const host = os.hostname();
    const tenantId = tenantIdForWrite();
    const feedLog = tenantDataPath(FEED_LOG);
    let line: string;
    try {
      line = formatLocalFeedLine({ timestamp, tenantId, oracle, host, event, project, sessionId: session_id, message });
    } catch {
      set.status = 400;
      return { error: 'Missing required fields: oracle, event' };
    }

    fs.mkdirSync(path.dirname(feedLog), { recursive: true });
    fs.appendFileSync(feedLog, line);
    return { success: true, timestamp, tenant_id: tenantId };
  } catch (e: any) {
    set.status = 500;
    return { error: e.message };
  }
}, {
  body: CreateFeedBody,
  detail: {
    tags: ['feed'],
    menu: { group: 'hidden' },
    summary: 'Append a feed event',
  },
});
