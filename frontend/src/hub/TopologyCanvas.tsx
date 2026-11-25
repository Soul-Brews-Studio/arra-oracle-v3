/**
 * The Topology drawing (#3110): org vault (truth) → hub → nodes, Ossie as a one-way exit.
 * SVG only; every number comes from GET /api/arra/topology.
 */

import type { Topology, TopologyNode } from './topology-api';
import { ago, maskIp, shortSha } from './format';
import { bottom, HUB, nodeBoxes, OSSIE, PRIVATE, top, TOPO_W, TRUNK_Y, VAULT, type Box } from './topology-layout';

const STATE = {
  active: { stroke: '#34d399', fill: 'rgba(16,185,129,0.10)', text: '#6ee7b7', dash: undefined },
  expired: { stroke: '#fbbf24', fill: 'rgba(245,158,11,0.10)', text: '#fcd34d', dash: '6 4' },
  revoked: { stroke: '#fb7185', fill: 'rgba(244,63,94,0.10)', text: '#fda4af', dash: '6 4' },
} as const;

function Rect({ b, stroke, fill = '#0b1220', dash, width = 1.5 }: { b: Box; stroke: string; fill?: string; dash?: string; width?: number }) {
  return <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={10} fill={fill} stroke={stroke} strokeWidth={width} strokeDasharray={dash} />;
}

function Lines({ x, y, lines }: { x: number; y: number; lines: Array<[string, string?, number?]> }) {
  return <>{lines.map(([t, c = '#cbd5e1', size = 12], i) => <text key={i} x={x} y={y + i * 17} fill={c} fontSize={size} fontFamily="ui-monospace, monospace">{t}</text>)}</>;
}

function NodeBox({ n, b, selected, showIps, onPick }: { n: TopologyNode; b: Box; selected: boolean; showIps: boolean; onPick?: (id: string) => void }) {
  const s = STATE[n.state] ?? STATE.revoked;
  const life = n.state === 'revoked' ? `revoked ${ago(n.revokedAt)}` : n.expiresAt ? n.left : 'forever';
  return (
    <g data-node={n.id} data-state={n.state} onClick={() => onPick?.(n.id)} style={{ cursor: onPick ? 'pointer' : undefined }}>
      <Rect b={b} stroke={selected ? '#e2e8f0' : s.stroke} fill={s.fill} dash={s.dash} width={selected ? 2.5 : 1.5} />
      <Lines x={b.x + 10} y={b.y + 20} lines={[
        [n.label.slice(0, 22), '#f1f5f9', 13],
        [n.id.slice(0, 24), '#64748b', 10],
        [n.state.toUpperCase(), s.text, 12],
        [`seen ${ago(n.lastSeenAt)}`],
        [`calls ${n.calls} · ${life}`.slice(0, 26)],
        [n.refused.count ? `refused 403 x${n.refused.count}` : `ip ${showIps ? n.lastIp ?? '-' : maskIp(n.lastIp)}`, n.refused.count ? s.text : '#94a3b8'],
      ]} />
    </g>
  );
}

export function TopologyCanvas({ t, selected, showIps, onPick }: { t: Topology; selected?: string | null; showIps: boolean; onPick?: (id: string) => void }) {
  const { nodes: boxes, strangers, height } = nodeBoxes(t.nodes.length);
  const hb = bottom(HUB);
  const o = t.ossie;
  const official = o.official ? `${o.official.passed ? 'PASSED' : 'FAILED'} ${ago(o.official.at)}${o.official.current ? '' : ' (older export)'}` : 'not run yet';
  return (
    <svg viewBox={`0 0 ${TOPO_W} ${height}`} className="w-full" role="img" aria-label="hub topology">
      <defs>
        <marker id="topo-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#94a3b8" /></marker>
      </defs>
      <g data-box="vault">
        <Rect b={VAULT} stroke="#a78bfa" />
        <Lines x={VAULT.x + 12} y={VAULT.y + 22} lines={[
          ['TRUTH · org vault (git)', '#c4b5fd', 11],
          [t.truth ? t.truth.name : 'no vault', '#f1f5f9', 14],
          [t.truth ? `commit ${shortSha(t.truth.sha)}${t.truth.dirty ? ' · dirty' : ''}` : '-'],
          [t.truth?.committedAt ? `last commit ${ago(t.truth.committedAt)}` : '', '#94a3b8'],
        ]} />
      </g>
      <g data-box="private">
        <Rect b={PRIVATE} stroke="#64748b" dash="5 5" fill="transparent" />
        <Lines x={PRIVATE.x + 12} y={PRIVATE.y + 22} lines={[
          ['oracle repo ψ/ · private notes', '#94a3b8', 11],
          ['stays on each node', '#e2e8f0', 13],
          ["indexed into that node's own .arra/", '#94a3b8', 11],
          ['never sent to the hub', '#94a3b8', 11],
        ]} />
      </g>
      <line x1={VAULT.x + VAULT.w / 2} y1={VAULT.y + VAULT.h} x2={VAULT.x + VAULT.w / 2} y2={HUB.y} stroke="#a78bfa" strokeWidth={1.5} markerEnd="url(#topo-arrow)" />
      <text x={VAULT.x + VAULT.w / 2 + 8} y={(VAULT.y + VAULT.h + HUB.y) / 2 + 4} fill="#94a3b8" fontSize={11}>index (rebuildable cache)</text>
      <g data-box="hub">
        <Rect b={HUB} stroke="#38bdf8" width={3} />
        <Lines x={HUB.x + 14} y={HUB.y + 24} lines={[
          ['HUB · arra serve --hub', '#7dd3fc', 11],
          [t.hub ? `hub:${t.hub.name}` : 'not a hub', '#f1f5f9', 16],
          [t.hub ? `port ${t.hub.port ?? '-'} · ${t.hub.docs} shared docs` : ''],
          [`viewer: ${t.viewer} (this machine)`, '#6ee7b7'],
          ['/api/federation/* · tailnet/LAN only', '#94a3b8', 11],
        ]} />
      </g>
      <g data-box="ossie">
        <Rect b={OSSIE} stroke={o.check.ok ? '#34d399' : '#fb7185'} />
        <Lines x={OSSIE.x + 12} y={OSSIE.y + 22} lines={[
          [`OSSIE export · ${o.version}`, '#c4b5fd', 11],
          [`check ${o.check.ok ? 'ok' : `${o.check.errors.length} errors`} · ${o.check.concepts} concepts`, o.check.ok ? '#6ee7b7' : '#fda4af'],
          ['validator', '#94a3b8', 11],
          [official, o.official?.passed && o.official.current ? '#6ee7b7' : '#fcd34d'],
          ['read-only, never feeds back', '#64748b', 10],
        ]} />
      </g>
      <line x1={HUB.x + HUB.w} y1={HUB.y + HUB.h / 2} x2={OSSIE.x} y2={OSSIE.y + OSSIE.h / 2} stroke="#a78bfa" strokeWidth={1.5} markerEnd="url(#topo-arrow)" />
      <text x={HUB.x + HUB.w + 6} y={HUB.y + HUB.h / 2 - 8} fill="#94a3b8" fontSize={10}>GET ?format=ossie</text>
      <line x1={hb.x} y1={hb.y} x2={hb.x} y2={TRUNK_Y} stroke="#94a3b8" strokeWidth={1.5} />
      <text x={hb.x + 8} y={TRUNK_Y - 12} fill="#cbd5e1" fontSize={11}>Bearer node token + private-IP check</text>
      {[...boxes, strangers].map((b, i) => {
        const tp = top(b);
        const n = t.nodes[i];
        const s = n ? STATE[n.state] ?? STATE.revoked : { stroke: '#fb7185', dash: '3 4' };
        return <path key={`e${i}`} d={`M${hb.x},${TRUNK_Y} H${tp.x} V${tp.y}`} fill="none" stroke={s.stroke} strokeOpacity={0.7} strokeDasharray={s.dash} strokeWidth={1.5} markerEnd="url(#topo-arrow)" />;
      })}
      {t.nodes.map((n, i) => <NodeBox key={n.id} n={n} b={boxes[i]} selected={selected === n.id} showIps={showIps} onPick={onPick} />)}
      <g data-box="strangers">
        <Rect b={strangers} stroke="#fb7185" dash="3 4" fill="transparent" />
        <Lines x={strangers.x + 10} y={strangers.y + 20} lines={[
          ['strangers', '#fda4af', 13],
          ['no code / bad token', '#64748b', 10],
          [`401 x${t.door.strangers.count}`, '#fda4af', 14],
          [t.door.strangers.lastAt ? `last ${ago(t.door.strangers.lastAt)}` : 'none yet', '#94a3b8'],
          [`outside 403 x${t.door.outside.count}`],
          [`since ${ago(t.door.since)}`, '#64748b', 10],
        ]} />
      </g>
    </svg>
  );
}
