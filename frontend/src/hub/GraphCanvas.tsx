/** SVG drawing of a laid-out graph: colour per kind, click to select, neighbours stay lit. */

import { useMemo } from 'react';
import { fitBox, layout, neighbours } from './force';

export interface CanvasNode { id: string; kind: string; label: string; dim?: boolean }
export interface CanvasEdge { from: string; to: string; kind: string; label?: string }

export const KIND_COLOUR: Record<string, string> = {
  Document: '#38bdf8', Concept: '#a78bfa', Source: '#34d399', Vault: '#fbbf24', Node: '#f472b6', RetiredEntry: '#fb7185',
  EntityType: '#38bdf8', ValueType: '#a78bfa', BuiltIn: '#64748b',
};
/** Plain words for each kind; the code name stays in the tooltip. */
export const KIND_NAME: Record<string, string> = {
  Document: 'Note', Concept: 'Topic', Source: 'Source', Vault: 'Vault (git)', Node: 'Machine', RetiredEntry: 'Retired record',
  EntityType: 'Thing', ValueType: 'Field', BuiltIn: 'Built-in type',
};
/** Edge labels only in the overview and only while they cannot pile up; a selected node's links are listed as sentences beside the canvas. */
export const EDGE_LABELS_AT_ONCE = 12;
const MAX_LABEL = 18;
const cut = (s: string) => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1)}…` : s);
const RADIUS: Record<string, number> = { Document: 7, Concept: 9, Source: 16, Vault: 16, Node: 11, RetiredEntry: 10, EntityType: 22, ValueType: 14, BuiltIn: 12 };

interface Props {
  nodes: CanvasNode[]; edges: CanvasEdge[]; selected: string | null; onSelect: (id: string | null) => void;
  showLabels?: (n: CanvasNode) => boolean; edgeLabels?: boolean; size?: number; spread?: number;
}

export function GraphCanvas({ nodes, edges, selected, onSelect, showLabels, edgeLabels = false, size = 1000, spread = 1 }: Props) {
  const pos = useMemo(() => layout(nodes, edges, { size, spread }), [nodes, edges, size, spread]);
  const lit = neighbours(selected, edges);
  const box = useMemo(() => fitBox(pos), [pos]);
  const faded = (id: string) => selected !== null && !lit.has(id);
  return (
    <svg data-testid="graph-canvas" viewBox={box} className="h-[620px] w-full rounded-2xl bg-field" onClick={() => onSelect(null)} role="img" aria-label="graph">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" style={{ fill: 'var(--color-text-muted)' }} /></marker>
      </defs>
      {edges.map((e, i) => {
        const a = pos.get(e.from); const b = pos.get(e.to);
        if (!a || !b) return null;
        const on = selected !== null && lit.has(e.from) && lit.has(e.to) && (e.from === selected || e.to === selected);
        return (
          <g key={`${e.from}>${e.to}>${i}`} opacity={selected === null ? 0.55 : on ? 0.95 : 0.08}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={{ stroke: e.kind === 'superseded_by' || e.kind === 'retires' ? 'var(--color-err-text)' : 'var(--color-text-muted)' }}
              strokeWidth={on ? 2 : 1} strokeDasharray={e.kind === 'extends' || e.kind === 'recorded_in' ? '4 4' : undefined} markerEnd={edgeLabels || e.kind === 'superseded_by' ? 'url(#arrow)' : undefined} />
            {edgeLabels && e.label && e.from !== e.to && selected === null && edges.length <= EDGE_LABELS_AT_ONCE && (
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 5} textAnchor="middle" fontSize="13" style={{ fill: 'var(--color-text-muted)', stroke: 'var(--color-bg)' }} strokeWidth={4} paintOrder="stroke">{e.label}</text>
            )}
          </g>
        );
      })}
      {nodes.map((n) => {
        const p = pos.get(n.id)!;
        const r = RADIUS[n.kind] ?? 8;
        const label = n.id === selected || (showLabels ? showLabels(n) : true);
        return (
          <g key={n.id} data-node={n.id} transform={`translate(${p.x},${p.y})`} opacity={faded(n.id) ? 0.15 : n.dim ? 0.55 : 1}
            className="cursor-pointer" onClick={(ev) => { ev.stopPropagation(); onSelect(n.id); }}>
            <circle r={r} fill={KIND_COLOUR[n.kind] ?? '#94a3b8'} style={{ stroke: n.id === selected ? 'var(--color-text)' : 'var(--color-bg)' }} strokeWidth={n.id === selected ? 3 : 1.5} />
            {label && <text y={r + 15} textAnchor="middle" fontSize={n.kind === 'Document' ? 12 : 14} style={{ fill: 'var(--color-text)', stroke: 'var(--color-bg)' }} strokeWidth={4} paintOrder="stroke">{n.id === selected ? n.label : cut(n.label)}</text>}
            <title>{`${KIND_NAME[n.kind] ?? n.kind} (${n.kind}): ${n.label}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

export function Legend({ kinds, counts }: { kinds: string[]; counts?: Record<string, number> }) {
  return (
    <div data-testid="legend" className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-text">
      {kinds.map((k) => (
        <span key={k} title={k} className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: KIND_COLOUR[k] }} />
          {KIND_NAME[k] ?? k}{counts && <span className="font-mono text-text-muted">{counts[k] ?? 0}</span>}
        </span>
      ))}
    </div>
  );
}
