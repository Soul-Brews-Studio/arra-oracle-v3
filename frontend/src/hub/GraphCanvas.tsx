/** SVG drawing of a laid-out graph: colour per kind, click to select, neighbours stay lit. */

import { useMemo } from 'react';
import { fitBox, layout, neighbours } from './force';

export interface CanvasNode { id: string; kind: string; label: string; dim?: boolean }
export interface CanvasEdge { from: string; to: string; kind: string; label?: string }

export const KIND_COLOUR: Record<string, string> = {
  Document: '#38bdf8', Concept: '#a78bfa', Source: '#34d399', Vault: '#fbbf24', Node: '#f472b6', RetiredEntry: '#fb7185',
  EntityType: '#38bdf8', ValueType: '#a78bfa', BuiltIn: '#64748b',
};
const RADIUS: Record<string, number> = { Document: 7, Concept: 9, Source: 16, Vault: 16, Node: 11, RetiredEntry: 10, EntityType: 22, ValueType: 14, BuiltIn: 12 };

interface Props {
  nodes: CanvasNode[]; edges: CanvasEdge[]; selected: string | null; onSelect: (id: string | null) => void;
  showLabels?: (n: CanvasNode) => boolean; edgeLabels?: boolean; size?: number;
}

export function GraphCanvas({ nodes, edges, selected, onSelect, showLabels, edgeLabels = false, size = 1000 }: Props) {
  const pos = useMemo(() => layout(nodes, edges, { size }), [nodes, edges, size]);
  const lit = neighbours(selected, edges);
  const box = useMemo(() => fitBox(pos), [pos]);
  const faded = (id: string) => selected !== null && !lit.has(id);
  return (
    <svg data-testid="graph-canvas" viewBox={box} className="h-[620px] w-full rounded-lg bg-gray-950" onClick={() => onSelect(null)} role="img" aria-label="graph">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#475569" /></marker>
      </defs>
      {edges.map((e, i) => {
        const a = pos.get(e.from); const b = pos.get(e.to);
        if (!a || !b) return null;
        const on = selected !== null && lit.has(e.from) && lit.has(e.to) && (e.from === selected || e.to === selected);
        return (
          <g key={`${e.from}>${e.to}>${i}`} opacity={selected === null ? 0.55 : on ? 0.95 : 0.08}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={e.kind === 'superseded_by' || e.kind === 'retires' ? '#fb7185' : e.kind === 'extends' ? '#64748b' : '#475569'}
              strokeWidth={on ? 2 : 1} strokeDasharray={e.kind === 'extends' || e.kind === 'recorded_in' ? '4 4' : undefined} markerEnd={edgeLabels || e.kind === 'superseded_by' ? 'url(#arrow)' : undefined} />
            {edgeLabels && e.label && (selected === null || on) && (
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle" fontSize="11" fill="#94a3b8">{e.label}</text>
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
            <circle r={r} fill={KIND_COLOUR[n.kind] ?? '#94a3b8'} stroke={n.id === selected ? '#fff' : '#0f172a'} strokeWidth={n.id === selected ? 3 : 1.5} />
            {label && <text y={r + 13} textAnchor="middle" fontSize={n.kind === 'Document' ? 10 : 12} fill="#e2e8f0">{n.label}</text>}
            <title>{`${n.kind}: ${n.label}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

export function Legend({ kinds }: { kinds: string[] }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-gray-400">
      {kinds.map((k) => <span key={k} className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: KIND_COLOUR[k] }} />{k}</span>)}
    </div>
  );
}
