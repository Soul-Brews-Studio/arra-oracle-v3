import { useEffect, useMemo, useState } from 'react';
import { graphApi as defaultApi, OSSIE_URL, type GraphApi, type OssieDoc, type SchemaGraph } from './graph-api';
import { GraphCanvas, Legend } from './GraphCanvas';
import { Card, ErrorLine, ghost } from './ui';

export function OntologyView({ api = defaultApi, initial = null }: { api?: GraphApi; initial?: { schema: SchemaGraph; doc: OssieDoc } | null }) {
  const [schema, setSchema] = useState<SchemaGraph | null>(initial?.schema ?? null);
  const [doc, setDoc] = useState<OssieDoc | null>(initial?.doc ?? null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showValues, setShowValues] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    Promise.all([api.schema(), api.ossie()]).then(([s, d]) => { setSchema(s); setDoc(d); }, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, initial]);

  const visible = useMemo(() => {
    if (!schema) return { nodes: [], edges: [] };
    const keep = new Set(schema.nodes.filter((n) => showValues || n.kind === 'EntityType').map((n) => n.id));
    return {
      nodes: schema.nodes.filter((n) => keep.has(n.id)).map((n) => ({ id: n.id, kind: n.kind, label: n.label })),
      edges: schema.edges.filter((e) => keep.has(e.from) && keep.has(e.to)).map((e) => ({ ...e, label: e.kind === 'extends' ? 'extends' : e.label.split('.')[1] })),
    };
  }, [schema, showValues]);
  const concept = doc?.ontology.find((c) => c.concept === selected) ?? null;

  return (
    <Card title={doc ? `Ontology · ${doc.name} (Apache Ossie ${doc.version})` : 'Ontology'} right={
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-gray-400"><input type="checkbox" checked={showValues} onChange={(e) => setShowValues(e.target.checked)} /> value types</label>
        <a className={ghost} href={OSSIE_URL} download="arra.ontology.json">Ossie JSON</a>
      </div>
    }>
      <div className="mb-3"><Legend kinds={['EntityType', 'ValueType', 'BuiltIn']} /></div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
        {schema ? <GraphCanvas nodes={visible.nodes} edges={visible.edges} selected={selected} onSelect={setSelected} edgeLabels size={900} />
          : <div className="flex h-[620px] items-center justify-center rounded-lg bg-gray-950 text-sm text-gray-500">Loading…</div>}
        <aside data-testid="ontology-detail" className="space-y-3 rounded-lg border border-gray-800 bg-gray-950/60 p-4 text-sm">
          {!concept && <p className="text-gray-500">{doc?.description ?? ''} Click a concept to read its relationships.</p>}
          {concept && (
            <>
              <div><div className="text-xs uppercase tracking-wider text-gray-500">{concept.type}</div><div className="mt-1 text-lg text-gray-100">{concept.concept}</div></div>
              {concept.description && <p className="text-gray-400">{concept.description}</p>}
              {concept.identify_by && <div className="font-mono text-xs text-gray-500">identified by {concept.identify_by.join(' + ')}</div>}
              {concept.requires?.map((r) => <div key={r} className="break-words font-mono text-xs text-amber-300/80">requires {r}</div>)}
              <ul className="space-y-1">
                {(concept.relationships ?? []).map((r) => (
                  <li key={r.name} className="text-gray-300">{r.verbalizes[0]}{r.multiplicity && <span className="ml-1 font-mono text-xs text-gray-500">{r.multiplicity}</span>}</li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
      <ErrorLine error={error} />
      <p className="mt-3 text-xs text-gray-500">Exported as an Apache Ossie ontology document: GET /api/arra/ontology?format=ossie · arra ontology --ossie. Checked with the Ossie validator.</p>
    </Card>
  );
}
