import { Elysia } from 'elysia';
import { sqlite } from '../db/index.ts';
import { currentTenantId } from '../middleware/tenant.ts';

type SessionRow = { name: string; last_seen: number | null; traces: number };

function tenantClause(): { sql: string; params: string[] } {
  const tenantId = currentTenantId();
  return tenantId ? { sql: 'WHERE tenant_id = ?', params: [tenantId] } : { sql: '', params: [] };
}

function sessions(): SessionRow[] {
  try {
    const where = tenantClause();
    return sqlite.prepare(`
      SELECT COALESCE(session_id, trace_id, 'unknown') as name,
             max(created_at) as last_seen,
             count(*) as traces
      FROM trace_log
      ${where.sql}
      GROUP BY COALESCE(session_id, trace_id, 'unknown')
      ORDER BY last_seen DESC
      LIMIT 100
    `).all(...where.params) as SessionRow[];
  } catch {
    return [];
  }
}

function bodyKeys(body: unknown): string[] {
  return body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).slice(0, 20) : [];
}

function base(source: string) {
  return { success: true, ok: true, source, compat: 'old-studio', checked_at: new Date().toISOString() };
}

export const oldStudioCompatRoutes = new Elysia()
  .get('/api/sessions', () => {
    const rows = sessions();
    return { ...base('trace_log'), sessions: rows, total: rows.length };
  }, {
    detail: {
      tags: ['sessions'],
      menu: { group: 'hidden' },
      summary: 'Old Studio session list compatibility endpoint',
    },
  })
  .get('/api/capture', () => ({
    ...base('compat-stub'),
    status: 'available',
    captured: false,
    captures: [],
    total: 0,
  }), {
    detail: {
      tags: ['system'],
      menu: { group: 'hidden' },
      summary: 'Old Studio capture compatibility status',
    },
  })
  .post('/api/capture', ({ body }) => ({
    ...base('compat-stub'),
    captured: false,
    accepted: true,
    fields: bodyKeys(body),
    message: 'Capture compatibility stub accepted the request.',
  }), {
    detail: {
      tags: ['system'],
      menu: { group: 'hidden' },
      summary: 'Old Studio capture compatibility stub',
    },
  })
  .get('/api/send', () => ({
    ...base('compat-stub'),
    status: 'available',
    delivered: false,
    queued: false,
  }), {
    detail: {
      tags: ['system'],
      menu: { group: 'hidden' },
      summary: 'Old Studio send compatibility status',
    },
  })
  .post('/api/send', ({ body }) => ({
    ...base('compat-stub'),
    delivered: false,
    queued: false,
    accepted: true,
    fields: bodyKeys(body),
    message: 'Send compatibility stub accepted the request without forwarding.',
  }), {
    detail: {
      tags: ['system'],
      menu: { group: 'hidden' },
      summary: 'Old Studio send compatibility stub',
    },
  });
