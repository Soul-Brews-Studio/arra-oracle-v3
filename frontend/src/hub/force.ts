/**
 * Small deterministic force layout for the hub graph views (no dependency): Fruchterman–Reingold
 * with seeded starting points, so the same graph always lands in the same place (stable screenshots).
 */

export interface LayoutNode { id: string }
export interface LayoutEdge { from: string; to: string }
export type Positions = Map<string, { x: number; y: number }>;

function seed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

export function layout(nodes: LayoutNode[], edges: LayoutEdge[], opts: { size?: number; iterations?: number; spread?: number } = {}): Positions {
  const size = opts.size ?? 1000;
  const n = nodes.length;
  const pos: Positions = new Map();
  nodes.forEach((node, i) => {
    const a = (i / Math.max(1, n)) * Math.PI * 2 + seed(node.id);
    const r = size * 0.35 * (0.5 + seed(`${node.id}#r`) / 2);
    pos.set(node.id, { x: size / 2 + r * Math.cos(a), y: size / 2 + r * Math.sin(a) });
  });
  if (n < 2) return pos;
  const k = Math.sqrt((size * size) / n) * 0.9 * (opts.spread ?? 1);
  const links = edges.filter((e) => pos.has(e.from) && pos.has(e.to) && e.from !== e.to);
  const iterations = opts.iterations ?? (n > 300 ? 120 : 220);
  let temp = size / 8;
  const ids = nodes.map((x) => x.id);
  const degree = new Map(ids.map((id) => [id, 0]));
  for (const e of links) { degree.set(e.from, degree.get(e.from)! + 1); degree.set(e.to, degree.get(e.to)! + 1); }
  for (let it = 0; it < iterations; it += 1) {
    const disp = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
    for (let i = 0; i < n; i += 1) {
      const a = pos.get(ids[i])!; const da = disp.get(ids[i])!;
      for (let j = i + 1; j < n; j += 1) {
        const b = pos.get(ids[j])!; const db = disp.get(ids[j])!;
        let dx = a.x - b.x; let dy = a.y - b.y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) { dx = seed(ids[i] + ids[j]) - 0.5; dy = 0.5 - seed(ids[j] + ids[i]); d = 0.01; }
        const f = (k * k) / d;
        da.x += (dx / d) * f; da.y += (dy / d) * f; db.x -= (dx / d) * f; db.y -= (dy / d) * f;
      }
    }
    for (const e of links) {
      const a = pos.get(e.from)!; const b = pos.get(e.to)!;
      const dx = a.x - b.x; const dy = a.y - b.y; const d = Math.max(0.01, Math.hypot(dx, dy));
      const f = (d * d) / k;
      const da = disp.get(e.from)!; const db = disp.get(e.to)!;
      da.x -= (dx / d) * f; da.y -= (dy / d) * f; db.x += (dx / d) * f; db.y += (dy / d) * f;
    }
    for (const id of ids) {
      const p = pos.get(id)!; const d = disp.get(id)!;
      const len = Math.max(0.01, Math.hypot(d.x, d.y));
      // gravity keeps disconnected pieces on screen; a node with no links is pulled harder
      const g = degree.get(id) ? 0.015 : 0.06;
      p.x += (d.x / len) * Math.min(len, temp) + (size / 2 - p.x) * g;
      p.y += (d.y / len) * Math.min(len, temp) + (size / 2 - p.y) * g;
    }
    temp *= 0.97;
  }
  return pos;
}

/** viewBox that fits every position with a margin. */
export function fitBox(pos: Positions, margin = 60): string {
  const xs = [...pos.values()].map((p) => p.x); const ys = [...pos.values()].map((p) => p.y);
  if (!xs.length) return '0 0 100 100';
  const x0 = Math.min(...xs) - margin; const y0 = Math.min(...ys) - margin;
  return `${x0} ${y0} ${Math.max(...xs) - x0 + margin} ${Math.max(...ys) - y0 + margin}`;
}

/** ids directly linked to `id`, plus itself. */
export function neighbours(id: string | null, edges: LayoutEdge[]): Set<string> {
  const out = new Set<string>();
  if (!id) return out;
  out.add(id);
  for (const e of edges) { if (e.from === id) out.add(e.to); if (e.to === id) out.add(e.from); }
  return out;
}
