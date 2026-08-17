/**
 * oracle_read access logging. Every successful read-through must land in the
 * owning document_access log with the document's own project — including the
 * file-only path, which has no id in the request and no project on ψ/memory
 * relative paths. Resolution is deterministic and ALWAYS tenant-scoped —
 * activeTenantId() falls back to 'default', so an ambient-less CLI context can
 * never widen the lookup across tenants. The active row wins; ties break by id.
 */

import type { ToolContext } from './types.ts';
import { activeTenantId } from '../middleware/tenant.ts';

let logDocumentAccessFn: typeof import('../server/logging.ts').logDocumentAccess | null = null;

interface ResolvedDoc {
  id: string;
  project: string | null;
}

function resolveDocForAccess(
  ctx: ToolContext,
  id: string | undefined,
  sourceFile: string | undefined,
): ResolvedDoc | null {
  const tenantId = activeTenantId();
  if (id) {
    const row = ctx.sqlite.prepare('SELECT id, project FROM oracle_documents WHERE id = ? AND tenant_id = ?')
      .get(id, tenantId) as ResolvedDoc | null;
    if (row) return row;
  }
  if (!sourceFile) return null;
  return (ctx.sqlite.prepare(`
    SELECT id, project FROM oracle_documents
    WHERE source_file = ? AND tenant_id = ?
    ORDER BY (superseded_by IS NULL) DESC, id
    LIMIT 1
  `).get(sourceFile, tenantId) as ResolvedDoc | null) ?? null;
}

export async function recordReadAccess(
  ctx: ToolContext,
  id: string | undefined,
  sourceFile: string | undefined,
  fallbackProject: string | null,
): Promise<void> {
  try {
    const doc = resolveDocForAccess(ctx, id, sourceFile);
    if (!doc) return;
    logDocumentAccessFn ??= (await import('../server/logging.ts')).logDocumentAccess;
    logDocumentAccessFn(doc.id, 'read', doc.project ?? fallbackProject ?? undefined);
  } catch (error) {
    console.error('[MCP:READ] Failed to log document access:', error);
  }
}
