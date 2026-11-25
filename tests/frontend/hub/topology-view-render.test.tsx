/** Topology tab: owner sees every box from the live payload; a visitor sees only the public card. */
import { describe, expect, test } from 'bun:test';
import { htmlFor } from '../_render';
import { TopologyView } from '../../../frontend/src/hub/TopologyView';
import type { HubApi } from '../../../frontend/src/hub/api';
import type { Topology, TopologyNode } from '../../../frontend/src/hub/topology-api';
import { nodeBoxes, PER_ROW } from '../../../frontend/src/hub/topology-layout';
import { tabFromHash, TABS } from '../../../frontend/src/hub/format';

const api = {} as HubApi;
const at = new Date().toISOString();
const n = (id: string, state: TopologyNode['state'], refused = 0): TopologyNode => ({
  id, label: id.replace(/-\d+$/, ''), url: null, joinedAt: at, expiresAt: state === 'expired' ? at : null, lastSeenAt: at,
  lastIp: '100.101.102.103', calls: 7, status: state === 'revoked' ? 'revoked' : 'active', state, left: '1h left',
  refused: { count: refused, lastAt: refused ? at : null }, ...(state === 'revoked' ? { revokedAt: at, revokeReason: 'test' } : {}),
});
const topology: Topology = {
  at, viewer: 'owner', privateNote: 'Private ψ/ notes stay on each node.',
  hub: { name: 'soul-brews', port: 47944, docs: 6 },
  truth: { name: 'soul-brews', sha: 'abcdef1234567890', dirty: false, committedAt: at },
  nodes: [n('node-a-1', 'revoked', 3), n('node-b-2', 'active'), n('guest-3', 'expired')],
  door: { since: at, strangers: { count: 2, lastAt: at }, outside: { count: 0, lastAt: null } },
  ossie: { url: '/api/arra/ontology?format=ossie', version: '0.3.0.dev0', name: 'ArraMemory', sha256: 'x',
    check: { ok: true, errors: [], concepts: 19, relationships: 20 }, official: { at, passed: true, ossieRef: 'd27a6be', sha256: 'x', current: true } },
};

describe('topology view', () => {
  test('owner: vault, hub, node boxes by state, strangers and the Ossie exit', () => {
    const html = htmlFor(<TopologyView api={api} owner publicHub={null} showIps={false} initial={topology} auto={false} />);
    for (const box of ['vault', 'private', 'hub', 'ossie', 'strangers']) expect(html).toContain(`data-box="${box}"`);
    expect(html).toContain('data-node="node-a-1" data-state="revoked"');
    expect(html).toContain('data-node="node-b-2" data-state="active"');
    expect(html).toContain('data-node="guest-3" data-state="expired"');
    expect(html).toContain('turned away 3 times');
    expect(html).toContain('2 turned away');
    expect(html).toContain('commit abcdef1');
    expect(html).toContain('port 47944');
    expect(html).toContain('validator passed');
    expect(html).toMatch(/Revoked \d+s ago/);
    expect(html).toContain('Active, no end date');
    expect(html).not.toContain('100.101.102.103');
  });
  test('plain-words legend: every state, the one-way arrow and the private-notes rule', () => {
    const html = htmlFor(<TopologyView api={api} owner publicHub={null} showIps={false} initial={topology} auto={false} />);
    expect(html).toContain('data-testid="topology-legend"');
    for (const w of ['Active', 'Expired', 'Revoked', 'Strangers', 'one way only', 'Private notes']) expect(html).toContain(w);
    // jargon stays out of the drawing and the legend
    for (const j of ['Bearer', '401', 'ψ/', '/api/federation']) expect(html).not.toContain(j);
  });
  test('no line of text runs past its box', () => {
    const long: Topology = { ...topology, nodes: [{ ...n('a-very-long-machine-label-that-goes-on-1', 'revoked', 12345) }] };
    const html = htmlFor(<TopologyView api={api} owner publicHub={null} showIps={false} initial={long} auto={false} />);
    const { nodes } = nodeBoxes(1);
    for (const m of html.matchAll(/<text[^>]*font-size="(\d+)"[^>]*>([^<]*)<\/text>/g)) {
      const width = Number(m[1]) * 0.56 * m[2].length;
      expect(width).toBeLessThanOrEqual(Math.max(nodes[0].w, 320) - 32 + 1);
    }
  });
  test('visitor: public card only', () => {
    const html = htmlFor(<TopologyView api={api} owner={false} publicHub={{ hub: 'soul-brews', sha: 'abcdef1234', nodes: 1 }} showIps={false} auto={false} />);
    expect(html).toContain('data-testid="visitor-note"');
    expect(html).toContain('hub:soul-brews');
    expect(html).not.toContain('data-node=');
    expect(html).not.toContain('data-box="ossie"');
  });
  test('layout: boxes never overlap, wrap after PER_ROW, strangers come last', () => {
    for (const count of [0, 1, 4, 5, 9, 12]) {
      const { nodes, strangers, height } = nodeBoxes(count);
      const all = [...nodes, strangers];
      expect(nodes.length).toBe(count);
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
      }
      expect(height).toBeGreaterThanOrEqual(strangers.y + strangers.h);
      expect(new Set(all.map((b) => b.y)).size).toBe(Math.ceil((count + 1) / PER_ROW));
    }
  });
  test('topology is a tab', () => {
    expect(TABS).toContain('topology');
    expect(tabFromHash('#/topology')).toBe('topology');
  });
});
