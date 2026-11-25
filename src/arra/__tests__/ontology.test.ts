/**
 * The arra ontology must be a valid Apache Ossie ontology document. These checks restate the rules
 * apache/ossie validation/validate.py applies to ontology documents (unique names, every extends /
 * role / identify_by resolving), plus verbalization placeholders; scripts/arra-proof/ossie-validate.sh
 * runs the real validator.
 */
import { describe, expect, test } from 'bun:test';
import { arraOntology, ontologyGraph, OSSIE_VERSION } from '../ontology.ts';

const BUILT_IN = new Set(['Any', 'Boolean', 'Date', 'DateTime', 'Decimal', 'Float', 'Integer', 'String']);
const o = arraOntology();
const declared = new Set(o.ontology.map((c) => c.concept));
const known = (name: string) => declared.has(name) || BUILT_IN.has(name);

describe('arra ontology as an Ossie document', () => {
  test('root fields', () => {
    expect(o.version).toBe(OSSIE_VERSION);
    expect(OSSIE_VERSION).toBe('0.3.0.dev0');
    expect(o.name).toBe('ArraMemory');
    expect(o.ontology.length).toBeGreaterThan(0);
  });
  test('concept names are unique and value types extend a built-in', () => {
    expect(declared.size).toBe(o.ontology.length);
    for (const c of o.ontology) {
      expect(['EntityType', 'ValueType']).toContain(c.type);
      for (const base of c.extends ?? []) expect(known(base)).toBe(true);
      if (c.type === 'ValueType') expect(c.extends?.some((b) => BUILT_IN.has(b) && b !== 'Any')).toBe(true);
    }
  });
  test('relationships: unique per concept, roles resolve, verbalizations name the roles', () => {
    for (const c of o.ontology) {
      const names = (c.relationships ?? []).map((r) => r.name);
      expect(new Set(names).size).toBe(names.length);
      for (const r of c.relationships ?? []) {
        expect(r.verbalizes.length).toBeGreaterThan(0);
        for (const role of r.roles ?? []) expect(known(role.concept)).toBe(true);
        for (const v of r.verbalizes) {
          const holes = [...v.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
          expect(holes[0]).toBe(c.concept);
          expect(holes.slice(1)).toEqual((r.roles ?? []).map((x) => (x.name ? `${x.concept}:${x.name}` : x.concept)));
        }
      }
      for (const id of c.identify_by ?? []) expect(names).toContain(id);
    }
  });
  test('it covers the arra memory types the hub UI draws', () => {
    for (const name of ['Document', 'Concept', 'Source', 'Vault', 'Hub', 'Node', 'RetiredEntry', 'DocType']) expect(declared.has(name)).toBe(true);
    const doc = o.ontology.find((c) => c.concept === 'Document')!;
    expect(doc.relationships!.map((r) => r.name)).toEqual(expect.arrayContaining(['tagged_with', 'comes_from', 'superseded_by']));
  });
  test('schema graph: one node per concept, relationship and extends edges', () => {
    const g = ontologyGraph(o);
    for (const c of o.ontology) expect(g.nodes.some((n) => n.id === c.concept && n.kind === c.type)).toBe(true);
    expect(g.nodes.some((n) => n.id === 'String' && n.kind === 'BuiltIn')).toBe(true);
    expect(g.edges).toContainEqual(expect.objectContaining({ from: 'Document', to: 'Concept', label: 'Document.tagged_with', kind: 'relationship' }));
    expect(g.edges).toContainEqual(expect.objectContaining({ from: 'DocId', to: 'String', kind: 'extends' }));
    for (const e of g.edges) expect(g.nodes.some((n) => n.id === e.to)).toBe(true);
  });
});
