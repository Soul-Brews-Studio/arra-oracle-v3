/** Graph and Ontology pages render from real backend output (buildGraph shape, arraOntology). */
import { describe, expect, test } from 'bun:test';
import { htmlFor } from '../_render';
import { GraphView } from '../../../frontend/src/hub/GraphView';
import { OntologyView } from '../../../frontend/src/hub/OntologyView';
import type { GraphApi, MemoryGraph } from '../../../frontend/src/hub/graph-api';
import { arraOntology, ontologyGraph } from '../../../src/arra/ontology';
import { tabFromHash } from '../../../frontend/src/hub/format';

const api = {} as GraphApi;
const graph: MemoryGraph = {
  nodes: [
    { id: 'doc:a', kind: 'Document', label: 'Wedging clay', source: 'hub:soul-brews', detail: 'a' },
    { id: 'concept:clay', kind: 'Concept', label: 'clay' },
    { id: 'source:hub:soul-brews', kind: 'Source', label: 'hub:soul-brews' },
    { id: 'vault:soul-brews', kind: 'Vault', label: 'soul-brews' },
  ],
  edges: [{ from: 'doc:a', to: 'concept:clay', kind: 'tagged_with' }, { from: 'doc:a', to: 'source:hub:soul-brews', kind: 'comes_from' }, { from: 'source:hub:soul-brews', to: 'vault:soul-brews', kind: 'synced_from' }],
  sources: ['hub:soul-brews', 'self'], omitted: { documents: 3, concepts: 2 },
};

describe('graph views', () => {
  test('graph page draws every node with a legend, source filter and omitted note', () => {
    const html = htmlFor(<GraphView api={api} initial={graph} />);
    for (const id of ['doc:a', 'concept:clay', 'source:hub:soul-brews', 'vault:soul-brews']) expect(html).toContain(`data-node="${id}"`);
    expect(html).toContain('<option value="self">self</option>');
    expect(html).toContain('Not drawn: 3 older documents');
    for (const k of ['Document', 'Concept', 'Source', 'Vault', 'RetiredEntry']) expect(html).toContain(k);
  });
  test('ontology page draws the Ossie concepts and links the export', () => {
    const html = htmlFor(<OntologyView api={api} initial={{ schema: ontologyGraph(), doc: arraOntology() }} />);
    expect(html).toContain('ArraMemory (Apache Ossie 0.3.0.dev0)');
    for (const c of ['Document', 'Concept', 'Source', 'Vault', 'Hub', 'Node', 'RetiredEntry']) expect(html).toContain(`data-node="${c}"`);
    expect(html).toContain('href="/api/v1/arra/ontology?format=ossie"');
    expect(html).toContain('>tagged_with<');
  });
  test('graph and ontology are tabs', () => {
    expect(tabFromHash('#/graph')).toBe('graph');
    expect(tabFromHash('#/ontology')).toBe('ontology');
  });
});
