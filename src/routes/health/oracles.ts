import { Elysia, t } from 'elysia';
import { sqlite } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';

function oraclesQuerySchema() {
  return t.Object({ hours: t.Optional(t.String()) });
}

function oraclesResponseSchema() {
  const identity = t.Object({
    oracle_name: t.String(),
    source: t.String(),
    last_seen: t.Nullable(t.Union([t.String(), t.Number()])),
    actions: t.Number(),
  });
  const project = t.Object({
    project: t.String(),
    docs: t.Number(),
    types: t.Number(),
    last_indexed: t.Nullable(t.Union([t.String(), t.Number()])),
  });
  return t.Object({
    identities: t.Array(identity),
    projects: t.Array(project),
    total_projects: t.Number(),
    total_identities: t.Number(),
    window_hours: t.Number(),
    tenant: t.Optional(t.Object({
      id: t.String(),
      scope: t.String(),
    })),
    cached_at: t.String(),
  });
}

interface OraclesResponse {
  identities: Array<{
    oracle_name: string;
    source: string;
    last_seen: string | number | null;
    actions: number;
  }>;
  projects: Array<{
    project: string;
    docs: number;
    types: number;
    last_indexed: string | number | null;
  }>;
  total_projects: number;
  total_identities: number;
  window_hours: number;
  tenant?: { id: string; scope: string };
  cached_at: string;
}

let oracleCache: { data: OraclesResponse; ts: number; key: string } | null = null;

export function createOraclesEndpoint() {
  return new Elysia().get('/oracles', ({ query }) => {
    const parsed = parseInt(query.hours ?? '168');
    const hours = Number.isFinite(parsed) ? parsed : 168;
    const now = Date.now();
    const tenantId = currentTenantId();
    const cacheKey = `${tenantId ?? '*'}:${hours}`;
    if (oracleCache && oracleCache.key === cacheKey && (now - oracleCache.ts) < 60_000) return oracleCache.data;

    const cutoff = now - hours * 3600_000;
    const docProjectWhere = tenantId ? 'AND tenant_id = ?' : '';
    const learnProjectWhere = tenantId ? 'AND tenant_id = ?' : '';
    const traceProjectWhere = tenantId ? 'AND tenant_id = ?' : '';
    const forumProjectWhere = tenantId ? 'AND forum_threads.tenant_id = ?' : '';
    const tenantArg = tenantId ? [tenantId] : [];
    const identities = sqlite.prepare(`
    SELECT oracle_name, source, max(last_seen) as last_seen, sum(actions) as actions
    FROM (
      SELECT author as oracle_name, 'forum' as source, max(forum_messages.created_at) as last_seen, count(*) as actions
        FROM forum_messages
        LEFT JOIN forum_threads ON forum_threads.id = forum_messages.thread_id
        WHERE author IS NOT NULL AND forum_messages.created_at > ? ${forumProjectWhere}
        GROUP BY author
      UNION ALL
      SELECT COALESCE(session_id, 'unknown') as oracle_name, 'trace' as source, max(created_at) as last_seen, count(*) as actions
        FROM trace_log WHERE created_at > ? ${traceProjectWhere}
        GROUP BY session_id
      UNION ALL
      SELECT COALESCE(source, project, 'unknown') as oracle_name, 'learn' as source, max(created_at) as last_seen, count(*) as actions
        FROM learn_log WHERE created_at > ? ${learnProjectWhere}
        GROUP BY COALESCE(source, project)
    )
    WHERE oracle_name IS NOT NULL AND oracle_name != 'unknown'
    GROUP BY oracle_name
    ORDER BY last_seen DESC
  `).all(cutoff, ...tenantArg, cutoff, ...tenantArg, cutoff, ...tenantArg) as OraclesResponse['identities'];

    const projects = sqlite.prepare(`
    SELECT project, count(*) as docs,
           count(DISTINCT type) as types,
           max(created_at) as last_indexed
    FROM oracle_documents
    WHERE project IS NOT NULL ${docProjectWhere}
    GROUP BY project
    ORDER BY last_indexed DESC
  `).all(...tenantArg) as OraclesResponse['projects'];

    const result: OraclesResponse = {
      identities,
      projects,
      total_projects: projects.length,
      total_identities: identities.length,
      window_hours: hours,
      tenant: tenantId ? { id: tenantId, scope: 'tenant_id' } : undefined,
      cached_at: new Date().toISOString(),
    };
    oracleCache = { data: result, ts: now, key: cacheKey };
    return result;
  }, {
    query: oraclesQuerySchema(),
    response: oraclesResponseSchema(),
    detail: {
      tags: ['health'],
      menu: { group: 'hidden' },
      description: 'Returns active oracle identities and project activity aggregates scoped by query window.',
      summary: 'Oracle identities + project activity',
    },
  });
}
