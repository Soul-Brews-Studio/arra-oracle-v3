import { useEffect, useMemo, useState } from 'react';
import { graphApi as defaultApi, type GraphApi, type MemoryGraph, type ReadDoc } from './graph-api';
import { GraphCanvas, Legend } from './GraphCanvas';
import { Card, ErrorLine, ghost, input } from './ui';

const KINDS = ['Document', 'Concept', 'Source', 'Vault', 'Node', 'RetiredEntry'];

export function GraphView({ api = defaultApi, initial = null }: { api?: GraphApi; initial?: MemoryGraph | null }) {
  const [source, setSource] = useState('');
  const [limit, setLimit] = useState(150);
  const [graph, setGraph] = useState<MemoryGraph | null>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [doc, setDoc] = useState<ReadDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    setError(null);
    api.graph(source, limit).then((g) => { setGraph(g); setSelected(null); setDoc(null); }, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, source, limit, initial]);

  const node = graph?.nodes.find((n) => n.id === selected) ?? null;
  useEffect(() => {
    setDoc(null);
    if (node?.kind === 'Document' && node.detail) api.read(node.detail).then(setDoc, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, node]);

  const canvasNodes = useMemo(() => (graph?.nodes ?? []).map((n) => ({ id: n.id, kind: n.kind, label: n.label, dim: n.superseded })), [graph]);
  const docCount = graph?.nodes.filter((n) => n.kind === 'Document').length ?? 0;
  const counts = useMemo(() => KINDS.map((k) => [k, graph?.nodes.filter((n) => n.kind === k).length ?? 0] as const), [graph]);

  return (
    <div className="space-y-5">
      <Card title="Memory graph" right={
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="text-gray-400">source <select aria-label="source" className={input} value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">all</option>
            {(graph?.sources ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select></label>
          <label className="text-gray-400">documents <select aria-label="limit" className={input} value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {[50, 150, 400].map((n) => <option key={n} value={n}>{n}</option>)}
          </select></label>
        </div>
      }>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <Legend kinds={KINDS} />
          <span className="font-mono text-xs text-gray-500">{counts.filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(' · ')}</span>
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
          {graph && graph.nodes.length > 0
            ? <GraphCanvas nodes={canvasNodes} edges={graph.edges} selected={selected} onSelect={setSelected}
                showLabels={(n) => n.kind !== 'Document' || docCount <= 15} />
            : <div className="flex h-[620px] items-center justify-center rounded-lg bg-gray-950 text-sm text-gray-500">{graph ? 'Nothing indexed for this source yet.' : 'Loading…'}</div>}
          <aside data-testid="graph-detail" className="space-y-3 rounded-lg border border-gray-800 bg-gray-950/60 p-4 text-sm">
            {!node && <p className="text-gray-500">Click a node. Documents open here; concepts, sources and vaults light up their links.</p>}
            {node && <div><div className="text-xs uppercase tracking-wider text-gray-500">{node.kind}</div><div className="mt-1 text-gray-100">{node.label}</div>
              {node.detail && <div className="mt-1 break-all font-mono text-xs text-gray-500">{node.detail}</div>}</div>}
            {node?.kind === 'Source' && <button className={ghost} onClick={() => setSource(node.label)}>Show only {node.label}</button>}
            {doc && (
              <div className="space-y-2 border-t border-gray-800 pt-3">
                <div className="font-mono text-xs text-gray-500">{doc.source} · {doc.type}{doc.created_by ? ` · by ${doc.created_by}` : ''}</div>
                {doc.superseded_by && <div className="text-xs text-rose-300">superseded by {doc.superseded_by}</div>}
                <pre className="max-h-[440px] overflow-auto whitespace-pre-wrap font-sans text-sm text-gray-300">{doc.content}</pre>
              </div>
            )}
          </aside>
        </div>
        <ErrorLine error={error} />
        {graph && (graph.omitted.documents > 0 || graph.omitted.concepts > 0) && (
          <p className="mt-3 text-xs text-gray-500">Not drawn: {graph.omitted.documents} older documents, {graph.omitted.concepts} rarely used concepts (shared by fewer than two of the drawn documents, or past the 60 most used).</p>
        )}
      </Card>
    </div>
  );
}
