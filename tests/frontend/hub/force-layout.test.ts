/** Hub graph layout: deterministic, connected nodes closer than unconnected ones, neighbours. */
import { describe, expect, test } from 'bun:test';
import { fitBox, layout, neighbours } from '../../../frontend/src/hub/force';

const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }));
const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'd', to: 'e' }];
const dist = (p: ReturnType<typeof layout>, x: string, y: string) => Math.hypot(p.get(x)!.x - p.get(y)!.x, p.get(x)!.y - p.get(y)!.y);

describe('force layout', () => {
  test('same graph, same picture', () => {
    expect([...layout(nodes, edges)]).toEqual([...layout(nodes, edges)]);
  });
  test('every node is placed at a finite point; linked nodes sit closer', () => {
    const p = layout(nodes, edges);
    for (const n of nodes) { expect(Number.isFinite(p.get(n.id)!.x)).toBe(true); expect(Number.isFinite(p.get(n.id)!.y)).toBe(true); }
    expect(dist(p, 'a', 'b')).toBeLessThan(dist(p, 'a', 'f'));
  });
  test('fitBox covers every point; neighbours includes itself', () => {
    const p = layout(nodes, edges);
    const [x, y, w, h] = fitBox(p).split(' ').map(Number);
    for (const q of p.values()) { expect(q.x).toBeGreaterThan(x); expect(q.y).toBeGreaterThan(y); expect(q.x).toBeLessThan(x + w); expect(q.y).toBeLessThan(y + h); }
    expect([...neighbours('b', edges)].sort()).toEqual(['a', 'b', 'c']);
    expect(neighbours(null, edges).size).toBe(0);
    expect(fitBox(new Map())).toBe('0 0 100 100');
  });
});
