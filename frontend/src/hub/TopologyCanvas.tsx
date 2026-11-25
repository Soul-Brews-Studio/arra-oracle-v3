/**
 * The Topology drawing (#3110): read top to bottom — source of truth → hub → machines;
 * Ossie is a one-way exit to the right of the hub. SVG only; every number comes from
 * GET /api/arra/topology. Three short lines per box, no labels on lines: the legend under
 * the drawing (TopologyLegend) says what colours and dashes mean.
 */

import type { Topology, TopologyNode } from './topology-api';
import { ago, shortSha } from './format';
import { bottom, CAPTION_X, CAPTIONS, fit, HUB, nodeBoxes, OSSIE, top, TOPO_W, TRUNK_Y, VAULT, type Box } from './topology-layout';
import { activityLine, EXPORT, ossieLine, STATE, stateOf, statusLine, STRANGER, strangerLines } from './topology-words';

const SANS = 'ui-sans-serif, system-ui, -apple-system, sans-serif';
const MUTED = 'var(--color-text-muted)';
const TEXT = 'var(--color-text)';
/** One arrowhead per line colour (context-stroke is not in every iPad Safari). */
const ARROWS = [EXPORT, STATE.active.stroke, STATE.expired.stroke, STATE.revoked.stroke];
const arrowId = (c: string) => `topo-arrow-${ARROWS.indexOf(c)}`;
const arrow = (c: string) => `url(#${arrowId(c)})`;

function Rect({ b, stroke, fill = 'var(--color-surface)', dash, width = 1.5 }: { b: Box; stroke: string; fill?: string; dash?: string; width?: number }) {
  return <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={12} style={{ fill, stroke }} strokeWidth={width} strokeDasharray={dash} />;
}

type Line = { t: string; c?: string; size?: number; bold?: boolean };
/** Up to three lines, each cut to the box width so nothing runs past the edge. */
function Lines({ b, lines, centre = false }: { b: Box; lines: Line[]; centre?: boolean }) {
  const pad = 16;
  const x = centre ? b.x + b.w / 2 : b.x + pad;
  let y = b.y + 30;
  return (
    <>
      {lines.map(({ t, c = TEXT, size = 15, bold }, i) => {
        const el = <text key={i} x={x} y={y} style={{ fill: c }} fontSize={size} fontWeight={bold ? 600 : 400} fontFamily={SANS} textAnchor={centre ? 'middle' : 'start'}>{fit(t, b.w - 2 * pad, size)}</text>;
        y += size + 9;
        return el;
      })}
    </>
  );
}

function Caption({ y, children }: { y: number; children: string }) {
  return <text x={CAPTION_X} y={y} style={{ fill: MUTED }} fontSize={14} fontFamily={SANS} letterSpacing="0.04em">{children}</text>;
}

function NodeBox({ n, b, selected, onPick }: { n: TopologyNode; b: Box; selected: boolean; onPick?: (id: string) => void }) {
  const s = stateOf(n);
  const act = activityLine(n);
  return (
    <g data-node={n.id} data-state={n.state} onClick={() => onPick?.(n.id)} style={{ cursor: onPick ? 'pointer' : undefined }}>
      <title>{`${n.label} (${n.id})`}</title>
      <Rect b={b} stroke={selected ? TEXT : s.stroke} fill={s.fill} dash={selected ? undefined : s.dash} width={selected ? 3 : 2} />
      <Lines b={b} lines={[
        { t: n.label, c: TEXT, size: 18, bold: true },
        { t: statusLine(n), c: s.text, size: 15 },
        { t: act.text, c: act.alert ? s.text : MUTED, size: 14 },
      ]} />
    </g>
  );
}

export function TopologyCanvas({ t, selected, onPick }: { t: Topology; selected?: string | null; onPick?: (id: string) => void }) {
  const { nodes: boxes, strangers, height } = nodeBoxes(t.nodes.length);
  const hb = bottom(HUB);
  const vb = bottom(VAULT);
  const o = ossieLine(t.ossie);
  const commit = t.truth ? `${t.truth.name} · commit ${shortSha(t.truth.sha)}${t.truth.committedAt ? ` · ${ago(t.truth.committedAt)}` : ''}${t.truth.dirty ? ' · unsaved edits' : ''}` : 'no vault connected';
  return (
    <svg viewBox={`0 0 ${TOPO_W} ${height}`} className="w-full" role="img" aria-label="hub topology: source of truth, hub, machines">
      <defs>
        {ARROWS.map((c) => <marker key={c} id={arrowId(c)} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style={{ fill: c }} /></marker>)}
      </defs>

      <Caption y={CAPTIONS.truth}>Source of truth</Caption>
      <g data-box="vault">
        <Rect b={VAULT} stroke={EXPORT} width={2} />
        <Lines b={VAULT} centre lines={[
          { t: 'Org vault (git)', c: TEXT, size: 18, bold: true },
          { t: commit, c: MUTED, size: 14 },
        ]} />
      </g>
      <line x1={vb.x} y1={vb.y} x2={vb.x} y2={HUB.y} style={{ stroke: EXPORT }} strokeWidth={2} markerEnd={arrow(EXPORT)} />

      <Caption y={CAPTIONS.hub}>Hub</Caption>
      <g data-box="hub">
        <Rect b={HUB} stroke="var(--color-accent)" width={3} />
        <Lines b={HUB} centre lines={[
          { t: t.hub ? `hub:${t.hub.name}` : 'not a hub', c: TEXT, size: 20, bold: true },
          { t: t.hub ? `${t.hub.docs} shared notes · port ${t.hub.port ?? '-'}` : '', c: MUTED, size: 14 },
          { t: 'you are the owner', c: 'var(--color-ok-text)', size: 14 },
        ]} />
      </g>
      <g data-box="ossie">
        <Rect b={OSSIE} stroke={EXPORT} dash="7 5" fill="transparent" />
        <Lines b={OSSIE} lines={[
          { t: 'Ossie export', c: EXPORT, size: 16, bold: true },
          { t: o.text, c: o.colour, size: 14 },
        ]} />
      </g>
      <line x1={HUB.x + HUB.w} y1={OSSIE.y + OSSIE.h / 2} x2={OSSIE.x - 2} y2={OSSIE.y + OSSIE.h / 2} style={{ stroke: EXPORT }} strokeWidth={2} markerEnd={arrow(EXPORT)} />

      <Caption y={CAPTIONS.nodes}>Machines that joined</Caption>
      <line x1={hb.x} y1={hb.y} x2={hb.x} y2={TRUNK_Y} style={{ stroke: 'var(--color-border)' }} strokeWidth={2} />
      {[...boxes, strangers].map((b, i) => {
        const tp = top(b);
        const n = t.nodes[i];
        const s = n ? stateOf(n) : STRANGER;
        return <path key={`e${i}`} d={`M${hb.x},${TRUNK_Y} H${tp.x} V${tp.y - 2}`} fill="none" style={{ stroke: s.stroke }} strokeOpacity={0.75} strokeDasharray={s.dash} strokeWidth={2} markerEnd={arrow(s.stroke)} />;
      })}
      {t.nodes.map((n, i) => <NodeBox key={n.id} n={n} b={boxes[i]} selected={selected === n.id} onPick={onPick} />)}
      <g data-box="strangers">
        <Rect b={strangers} stroke={STRANGER.stroke} dash={STRANGER.dash} fill="transparent" width={2} />
        <Lines b={strangers} lines={[
          { t: 'Strangers', c: STRANGER.text, size: 18, bold: true },
          ...strangerLines(t.door).map((l, i) => ({ t: l, c: i === 0 ? STRANGER.text : MUTED, size: i === 0 ? 15 : 14 })),
        ]} />
      </g>
    </svg>
  );
}
