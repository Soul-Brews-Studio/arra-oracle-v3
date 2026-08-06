import { sqlite } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';

type Map3dDoc = {
  id: string; type: string; title: string; source_file: string; concepts: string[];
  project: string | null; x: number; y: number; z: number; created_at: string | null;
};
type Map3dResult = {
  documents: Map3dDoc[];
  total: number;
  pca_info: { variance_explained: number[]; n_vectors: number; n_dimensions: number; computed_at: string };
};
type DocRow = {
  id: string; type: string; source_file: string; concepts: string | null;
  project: string | null; created_at: number | null;
};

const map3dCaches = new Map<string, { data: Map3dResult; timestamp: number }>();
const MAP3D_CACHE_TTL = 30 * 60 * 1000;
const MAP3D_DOC_LIMIT = 50_000;

function emptyResult(): Map3dResult {
  return {
    documents: [],
    total: 0,
    pca_info: { variance_explained: [], n_vectors: 0, n_dimensions: 3, computed_at: new Date().toISOString() },
  };
}

function concepts(value: string | null): string[] {
  try { return value ? JSON.parse(value) : []; } catch { return []; }
}

function title(sourceFile: string): string {
  return (sourceFile.split('/').pop() || sourceFile).replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
}

function hash(str: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    value ^= str.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return ((value >>> 0) % 10000) / 10000;
}

function point(index: number, total: number, row: DocRow) {
  if (total <= 1) return { x: 0, y: 0, z: 0 };
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (index / (total - 1)) * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = index * goldenAngle + hash(`${row.project ?? ''}:${row.source_file}`) * Math.PI * 2;
  return { x: radius * Math.cos(angle), y, z: radius * Math.sin(angle) };
}

function dbRows(tenantId?: string | null) {
  const where = tenantId ? 'WHERE d.tenant_id = ?' : '';
  const params = tenantId ? [tenantId] : [];
  const total = (sqlite.prepare(`
    SELECT COUNT(*) as total
    FROM oracle_documents d
    JOIN oracle_fts f ON f.id = d.id
    ${where}
  `).get(...params) as { total: number } | undefined)?.total ?? 0;
  const rows = sqlite.prepare(`
    SELECT d.id, d.type, d.source_file, d.concepts, d.project, d.created_at
    FROM oracle_documents d
    JOIN oracle_fts f ON f.id = d.id
    ${where}
    ORDER BY d.indexed_at DESC, d.id ASC
    LIMIT ?
  `).all(...params, MAP3D_DOC_LIMIT) as DocRow[];
  return { rows, total };
}

export async function handleMap3d(_model?: string): Promise<Map3dResult> {
  const tenantId = currentTenantId();
  const cacheKey = `${tenantId ?? '*'}:fts-db`;
  const cached = map3dCaches.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < MAP3D_CACHE_TTL) return cached.data;

  try {
    const { rows, total } = dbRows(tenantId);
    if (!rows.length) return emptyResult();
    const documents = rows.map((row, i) => {
      const p = point(i, rows.length, row);
      return {
        id: row.id,
        type: row.type,
        title: title(row.source_file),
        source_file: row.source_file,
        concepts: concepts(row.concepts).slice(0, 10),
        project: row.project,
        x: +p.x.toFixed(6),
        y: +p.y.toFixed(6),
        z: +p.z.toFixed(6),
        created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
      };
    });
    const result = {
      documents,
      total,
      pca_info: { variance_explained: [], n_vectors: total, n_dimensions: 3, computed_at: new Date().toISOString() },
    };
    map3dCaches.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Map3D Error]', msg);
    throw new Error(`Map3D generation failed: ${msg}`);
  }
}
