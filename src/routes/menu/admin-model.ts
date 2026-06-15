import { t } from 'elysia';
import { menuItems } from '../../db/index.ts';

export type MenuRow = typeof menuItems.$inferSelect;

function parseQuery(raw: string | null): Record<string, string> | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') out[key] = value;
      }
      return out;
    }
  } catch {}
  return null;
}

export const GroupSchema = t.Union([
  t.Literal('main'),
  t.Literal('tools'),
  t.Literal('admin'),
  t.Literal('hidden'),
]);
export const AccessSchema = t.Union([t.Literal('public'), t.Literal('auth')]);

export function toResponse(row: MenuRow) {
  return {
    id: row.id,
    path: row.path,
    label: row.label,
    groupKey: row.groupKey,
    parentId: row.parentId,
    position: row.position,
    enabled: row.enabled,
    access: row.access,
    source: row.source,
    icon: row.icon,
    host: row.host,
    hidden: row.hidden,
    scope: row.scope,
    query: parseQuery(row.query),
    touchedAt: row.touchedAt ? row.touchedAt.getTime() : null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

type ResponseRow = ReturnType<typeof toResponse>;
type TreeNode = ResponseRow & { children: TreeNode[] };

export function buildTree(rows: MenuRow[]): TreeNode[] {
  const nodes = new Map<number, TreeNode>();
  for (const row of rows) nodes.set(row.id, { ...toResponse(row), children: [] });

  const roots: TreeNode[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id)!;
    const parent = row.parentId == null ? null : nodes.get(row.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
