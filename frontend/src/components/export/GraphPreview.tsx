import { useId, useMemo, useRef } from 'react';

export type ExportGraphNode = {
  id: string;
  label?: string;
  type?: string;
  metadata?: Record<string, unknown>;
};

export type ExportGraphEdge = {
  id?: string;
  type: string;
  from: string;
  to: string;
  metadata?: Record<string, unknown>;
};

export type ExportGraphData = {
  nodes?: ExportGraphNode[];
  edges?: ExportGraphEdge[];
  relationships?: ExportGraphEdge[];
};

export interface GraphPreviewProps {
  data: ExportGraphData;
  title?: string;
  width?: number;
  height?: number;
  maxNodes?: number;
  iterations?: number;
  fileName?: string;
  onExportSvg?: (svg: string) => void;
}

type LayoutNode = ExportGraphNode & {
  x: number;
  y: number;
  degree: number;
};

function shortLabel(value: string, max = 22): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function hashUnit(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function graphEdges(data: ExportGraphData): ExportGraphEdge[] {
  return data.edges ?? data.relationships ?? [];
}

function graphNodes(data: ExportGraphData): ExportGraphNode[] {
  const nodes = new Map<string, ExportGraphNode>();
  for (const node of data.nodes ?? []) {
    if (node.id) nodes.set(node.id, node);
  }
  for (const edge of graphEdges(data)) {
    if (!nodes.has(edge.from)) nodes.set(edge.from, { id: edge.from });
    if (!nodes.has(edge.to)) nodes.set(edge.to, { id: edge.to });
  }
  return [...nodes.values()];
}

function layoutGraph(
  data: ExportGraphData,
  width: number,
  height: number,
  maxNodes: number,
  iterations: number,
): { nodes: LayoutNode[]; edges: ExportGraphEdge[]; hiddenNodes: number } {
  const allNodes = graphNodes(data);
  const visible = allNodes.slice(0, maxNodes);
  const allowed = new Set(visible.map((node) => node.id));
  const edges = graphEdges(data).filter((edge) => allowed.has(edge.from) && allowed.has(edge.to));
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.max(60, Math.min(width, height) * 0.34);
  const nodes = visible.map((node, index) => {
    const angle = (index / Math.max(visible.length, 1)) * Math.PI * 2 + hashUnit(node.id) * 0.25;
    return {
      ...node,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      degree: degree.get(node.id) ?? 0,
    };
  });
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));

  for (let step = 0; step < iterations; step += 1) {
    const dx = new Array(nodes.length).fill(0) as number[];
    const dy = new Array(nodes.length).fill(0) as number[];

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const left = nodes[i]!;
        const right = nodes[j]!;
        const offsetX = left.x - right.x || hashUnit(`${left.id}:${right.id}`) - 0.5;
        const offsetY = left.y - right.y || hashUnit(`${right.id}:${left.id}`) - 0.5;
        const distance = Math.max(8, Math.hypot(offsetX, offsetY));
        const force = Math.min(18, 2200 / (distance * distance));
        dx[i] += (offsetX / distance) * force;
        dy[i] += (offsetY / distance) * force;
        dx[j] -= (offsetX / distance) * force;
        dy[j] -= (offsetY / distance) * force;
      }
    }

    for (const edge of edges) {
      const from = indexById.get(edge.from);
      const to = indexById.get(edge.to);
      if (from === undefined || to === undefined) continue;
      const source = nodes[from]!;
      const target = nodes[to]!;
      const offsetX = target.x - source.x;
      const offsetY = target.y - source.y;
      const distance = Math.max(1, Math.hypot(offsetX, offsetY));
      const force = (distance - 120) * 0.035;
      dx[from] += (offsetX / distance) * force;
      dy[from] += (offsetY / distance) * force;
      dx[to] -= (offsetX / distance) * force;
      dy[to] -= (offsetY / distance) * force;
    }

    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i]!;
      dx[i] += (cx - node.x) * 0.018;
      dy[i] += (cy - node.y) * 0.018;
      node.x = clamp(node.x + clamp(dx[i]!, -14, 14), 36, width - 36);
      node.y = clamp(node.y + clamp(dy[i]!, -14, 14), 36, height - 36);
    }
  }

  return { nodes, edges, hiddenNodes: Math.max(0, allNodes.length - visible.length) };
}

function saveSvg(svg: SVGSVGElement, fileName: string, onExportSvg?: (svg: string) => void): void {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const source = new XMLSerializer().serializeToString(clone);
  onExportSvg?.(source);
  if (!globalThis.document?.createElement || !globalThis.URL?.createObjectURL) return;
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function GraphPreview({
  data,
  title = 'Graph preview',
  width = 760,
  height = 420,
  maxNodes = 80,
  iterations = 120,
  fileName = 'graph-preview.svg',
  onExportSvg,
}: GraphPreviewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const markerId = `graph-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const layout = useMemo(
    () => layoutGraph(data, width, height, maxNodes, iterations),
    [data, height, iterations, maxNodes, width],
  );
  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="graph-preview-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Export graph</p>
          <h2 id="graph-preview-title" className="mt-2 text-2xl font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm text-slate-400">
            {layout.nodes.length.toLocaleString()} nodes and {layout.edges.length.toLocaleString()} edges
            {layout.hiddenNodes ? ` shown, ${layout.hiddenNodes.toLocaleString()} hidden` : ''}
          </p>
        </div>
        <button
          className="focus-ring rounded-xl border border-teal-300/30 px-4 py-2 text-sm font-semibold text-teal-100 hover:bg-teal-300/10"
          type="button"
          onClick={() => { if (svgRef.current) saveSvg(svgRef.current, fileName, onExportSvg); }}
        >
          Export SVG
        </button>
      </div>
      <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-slate-950">
        <svg ref={svgRef} role="img" aria-label={title} viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
          <defs>
            <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#5eead4" opacity="0.75" />
            </marker>
          </defs>
          <rect width={width} height={height} fill="#020617" />
          {layout.edges.map((edge, index) => {
            const from = nodeById.get(edge.from);
            const to = nodeById.get(edge.to);
            if (!from || !to) return null;
            return (
              <line key={`${edge.from}-${edge.to}-${edge.type}-${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#5eead4" strokeOpacity="0.38" strokeWidth="1.5" markerEnd={`url(#${markerId})`}>
                <title>{`${edge.type}: ${edge.from} to ${edge.to}`}</title>
              </line>
            );
          })}
          {layout.nodes.map((node) => {
            const radius = clamp(7 + node.degree * 1.6, 8, 18);
            return (
              <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
                <circle r={radius} fill="#0f766e" stroke="#99f6e4" strokeWidth="1.5" />
                <text x={radius + 5} y="4" fill="#e2e8f0" fontSize="12" fontFamily="Inter, ui-sans-serif, system-ui">
                  {shortLabel(node.label ?? node.id)}
                </text>
                <title>{`${node.label ?? node.id}${node.type ? ` (${node.type})` : ''}`}</title>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
