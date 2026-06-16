import { sqlite } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';

const GRAPH_TYPES = ['principle', 'learning', 'retro'];

type DocRow = {
  id: string;
  type: string;
  source_file: string;
  concepts: string | null;
  project: string | null;
};

export function projectMatchesTenant(project: string, tenantId: string): boolean {
  const normalizedProject = project.trim().toLowerCase();
  const tenant = tenantId.trim().toLowerCase();
  if (!tenant || normalizedProject === tenant) return true;
  return normalizedProject.split(/[\\/]+/).filter(Boolean).includes(tenant);
}

export function projectAllowedForTenant(project?: string | null): boolean {
  const tenantId = currentTenantId();
  return !tenantId || !project || projectMatchesTenant(project, tenantId);
}

function parseConcepts(value: string | null): string[] {
  try { return JSON.parse(value || '[]') as string[]; } catch { return []; }
}

function tenantRows(type: string, tenantId: string, limit: number): DocRow[] {
  return sqlite.prepare(`
    SELECT id, type, source_file, concepts, project
    FROM oracle_documents
    WHERE tenant_id = ? AND type = ?
    ORDER BY RANDOM()
    LIMIT ?
  `).all(tenantId, type, limit) as DocRow[];
}

export function handleTenantGraph(limitPerType = 310): Record<string, unknown> | null {
  const tenantId = currentTenantId();
  if (!tenantId) return null;

  const perType = Math.min(Math.max(limitPerType, 10), 500);
  const docs = GRAPH_TYPES.flatMap((type) => tenantRows(type, tenantId, perType));
  const nodes = docs.map((doc) => ({
    id: doc.id,
    type: doc.type,
    source_file: doc.source_file,
    project: doc.project,
    concepts: parseConcepts(doc.concepts),
  }));

  const conceptSets = nodes.map((node) => new Set(node.concepts));
  const links: Array<{ source: string; target: string; weight: number }> = [];
  for (let i = 0; i < nodes.length && links.length < 5000; i++) {
    for (let j = i + 1; j < nodes.length && links.length < 5000; j++) {
      const weight = nodes[j].concepts.filter((concept) => conceptSets[i].has(concept)).length;
      if (weight >= 1) links.push({ source: nodes[i].id, target: nodes[j].id, weight });
    }
  }

  return { nodes, links };
}
