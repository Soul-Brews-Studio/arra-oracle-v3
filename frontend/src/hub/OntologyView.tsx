import { useEffect, useMemo, useState } from 'react';
import { graphApi as defaultApi, OSSIE_URL, type GraphApi, type OssieDoc, type SchemaGraph } from './graph-api';
import { GraphCanvas, KIND_NAME, Legend } from './GraphCanvas';
import { Card, ErrorLine, ghost } from './ui';

export function OntologyView({ api = defaultApi, initial = null }: { api?: GraphApi; initial?: { schema: SchemaGraph; doc: OssieDoc } | null }) {
  const [schema, setSchema] = useState<SchemaGraph | null>(initial?.schema ?? null);
  const [doc, setDoc] = useState<OssieDoc | null>(initial?.doc ?? null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showValues, setShowValues] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    Promise.all([api.schema(), api.ossie()]).then(([s, d]) => { setSchema(s); setDoc(d); }, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, initial]);

  const visible = useMemo(() => {
    if (!schema) return { nodes: [], edges: [] };
    // Built-in types (String, DateTime) only add a dashed "extends" line from every field: never drawn.
    const keep = new Set(schema.nodes.filter((n) => n.kind === 'EntityType' || (showValues && n.kind === 'ValueType')).map((n) => n.id));
    return {
      nodes: schema.nodes.filter((n) => keep.has(n.id)).map((n) => ({ id: n.id, kind: n.kind, label: n.label })),
      edges: schema.edges.filter((e) => keep.has(e.from) && keep.has(e.to)).map((e) => ({ ...e, label: e.kind === 'extends' ? 'extends' : e.label.split('.')[1] })),
    };
  }, [schema, showValues]);
  const concept = doc?.ontology.find((c) => c.concept === selected) ?? null;

  return (
    <Card title="What arra stores" right={
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 py-2 text-sm text-gray-400"><input type="checkbox" className="h-4 w-4" checked={showValues} onChange={(e) => setShowValues(e.target.checked)} /> show fields</label>
        <a className={ghost} href={OSSIE_URL} download="arra.ontology.json">Ossie JSON</a>
      </div>
    }>
      <div className="mb-3 space-y-2">
        <Legend kinds={showValues ? ['EntityType', 'ValueType'] : ['EntityType']} />
        <p className="text-sm text-gray-400">Each dot is a kind of thing arra keeps; a line is how two of them relate. Tap a dot to read its relationships.</p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {schema ? <GraphCanvas nodes={visible.nodes} edges={visible.edges} selected={selected} onSelect={setSelected} edgeLabels size={900} spread={showValues ? 2.2 : 3} />
          : <div className="flex h-[620px] items-center justify-center rounded-lg bg-gray-950 text-sm text-gray-500">Loading…</div>}
        <aside data-testid="ontology-detail" className="space-y-3 rounded-lg border border-gray-800 bg-gray-950/60 p-4 text-sm">
          {!concept && <p className="text-gray-400">{doc?.description ?? ''}</p>}
          {concept && (
            <>
              <div><div className="text-xs uppercase tracking-wider text-gray-500" title={concept.type}>{KIND_NAME[concept.type] ?? concept.type}</div><div className="mt-1 text-lg text-gray-100">{concept.concept}</div></div>
              {concept.description && <p className="text-gray-400">{concept.description}</p>}
              {concept.identify_by && <div className="font-mono text-xs text-gray-500">identified by {concept.identify_by.join(' + ')}</div>}
              {concept.requires?.map((r) => <div key={r} className="break-words font-mono text-xs text-amber-300/80">requires {r}</div>)}
              <ul className="space-y-1">
                {(concept.relationships ?? []).map((r) => (
                  <li key={r.name} className="text-gray-300">{r.verbalizes[0].replace(/[{}]/g, '')}{r.multiplicity && <span className="ml-1 font-mono text-xs text-gray-500">{r.multiplicity}</span>}</li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
      <ErrorLine error={error} />
      <p className="mt-3 text-xs text-gray-500">{doc ? `${doc.name} (Apache Ossie ${doc.version})` : 'Apache Ossie'}: GET /api/arra/ontology?format=ossie · arra ontology --ossie · checked with the Ossie validator.</p>
    </Card>
  );
}
