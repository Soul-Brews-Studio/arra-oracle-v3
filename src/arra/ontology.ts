/**
 * The ontology of arra memory, written as an Apache Ossie ontology document (#3110 graph view).
 *
 * Ossie (formerly Open Semantic Interchange, apache/ossie `ontology/ontology.md`, schema
 * `ontology/ontology.json`, version 0.3.0.dev0) describes a domain as concepts — EntityType or
 * ValueType — and the relationships each concept plays the first role in. Every relationship
 * says how to read a link aloud (`verbalizes`) and may carry a multiplicity. Data the spec does
 * not model goes in `annotations`.
 *
 * This one object is the source of truth for three things: `GET /api/arra/ontology?format=ossie`,
 * `arra ontology --ossie`, and the hub UI's Ontology view (via ontologyGraph()).
 */

export const OSSIE_VERSION = '0.3.0.dev0';

type Multiplicity = 'ManyToOne' | 'OneToOne';
export interface OssieRole { concept: string; name?: string }
export interface OssieRelationship { name: string; description?: string; multiplicity?: Multiplicity; roles?: OssieRole[]; verbalizes: string[]; annotations?: Record<string, unknown> }
export interface OssieConcept {
  concept: string; type: 'EntityType' | 'ValueType'; description?: string; extends?: string[];
  identify_by?: string[]; requires?: string[]; relationships?: OssieRelationship[]; annotations?: Record<string, unknown>;
}
export interface OssieOntology { version: string; name: string; description?: string; ontology: OssieConcept[]; annotations?: Record<string, unknown> }

export const DOC_TYPES = ['principle', 'pattern', 'learning', 'retro', 'distillation', 'security-corpus'] as const;
export const NODE_STATES = ['active', 'expired', 'revoked'] as const;

const value = (concept: string, base: string, description: string, extra: Partial<OssieConcept> = {}): OssieConcept =>
  ({ concept, type: 'ValueType', extends: [base], description, ...extra });
const oneOf = (concept: string, values: readonly string[]) => [values.map((v) => `${concept} == '${v}'`).join(' OR ')];
const rel = (first: string, name: string, other: string, verb: string, multiplicity?: Multiplicity, roleName?: string): OssieRelationship => ({
  name,
  ...(multiplicity ? { multiplicity } : {}),
  roles: [{ concept: other, ...(roleName ? { name: roleName } : {}) }],
  verbalizes: [`{${first}} ${verb} {${other}${roleName ? `:${roleName}` : ''}}`],
});

export function arraOntology(): OssieOntology {
  return {
    version: OSSIE_VERSION,
    name: 'ArraMemory',
    description: 'What an arra remembers: documents tagged with concepts, each from one source (self or a hub), kept in git vaults; hubs admit nodes; what ceases is recorded, never deleted.',
    annotations: { 'arra:spec': 'Soul-Brews-Studio/arra-oracle-v3#3110', 'arra:truth': 'vault markdown in git; .arra is a rebuildable cache' },
    ontology: [
      value('DocId', 'String', 'Stable document id; shared notes use hub:<vault>:<path>'),
      value('DocType', 'String', 'Kind of memory', { requires: oneOf('DocType', DOC_TYPES) }),
      value('FilePath', 'String', 'Path of the markdown file the document was indexed from'),
      value('ConceptName', 'String', 'A tag; documents list theirs in frontmatter'),
      value('SourceName', 'String', "Where a row came from: 'self' or 'hub:<name>'"),
      value('VaultName', 'String', 'Name of a git vault'),
      value('CommitSha', 'String', 'A git commit'),
      value('HubName', 'String', 'Name of a hub'),
      value('NodeId', 'String', 'Id a hub gives a joined node'),
      value('NodeState', 'String', 'A node is active until it expires or the hub revokes it', { requires: oneOf('NodeState', NODE_STATES) }),
      value('RetiredThing', 'String', 'Free-text name of what ceased, or of its successor'),
      value('Reason', 'String', 'Why something ceased'),
      {
        concept: 'Document', type: 'EntityType', description: 'One indexed memory row', identify_by: ['id'],
        annotations: { 'arra:table': 'oracle_documents' },
        relationships: [
          rel('Document', 'id', 'DocId', 'is identified by', 'OneToOne'),
          rel('Document', 'has_type', 'DocType', 'has type', 'ManyToOne'),
          rel('Document', 'indexed_from', 'FilePath', 'is indexed from', 'ManyToOne'),
          rel('Document', 'tagged_with', 'Concept', 'is tagged with'),
          rel('Document', 'comes_from', 'Source', 'comes from', 'ManyToOne'),
          rel('Document', 'indexed_at', 'DateTime', 'was indexed at', 'ManyToOne'),
          { ...rel('Document', 'superseded_by', 'Document', 'is superseded by', 'ManyToOne', 'successor'), annotations: { 'arra:column': 'superseded_by' } },
          rel('Document', 'superseded_because', 'Reason', 'was superseded because', 'ManyToOne'),
        ],
      },
      { concept: 'Concept', type: 'EntityType', description: 'A tag shared by documents', identify_by: ['name'], relationships: [rel('Concept', 'name', 'ConceptName', 'is named', 'OneToOne')] },
      {
        concept: 'Source', type: 'EntityType', description: "A search group: 'self' (this arra's own ψ) or 'hub:<name>' (synced from a vault)", identify_by: ['name'],
        relationships: [rel('Source', 'name', 'SourceName', 'is named', 'OneToOne'), rel('Source', 'synced_from', 'Vault', 'is synced from', 'ManyToOne')],
      },
      {
        concept: 'Vault', type: 'EntityType', description: 'A git repository of markdown; the truth everything else is rebuilt from', identify_by: ['name'],
        relationships: [rel('Vault', 'name', 'VaultName', 'is named', 'OneToOne'), rel('Vault', 'head', 'CommitSha', 'is at commit', 'ManyToOne')],
      },
      {
        concept: 'Hub', type: 'EntityType', description: 'An arra that opened the door to other machines', identify_by: ['name'],
        relationships: [rel('Hub', 'name', 'HubName', 'is named', 'OneToOne'), rel('Hub', 'serves', 'Vault', 'serves', 'ManyToOne')],
      },
      {
        concept: 'Node', type: 'EntityType', description: 'A machine that joined a hub with a one-use invite code', identify_by: ['id'],
        annotations: { 'arra:file': '.arra/hub-state.json (token stored as sha256 only)' },
        relationships: [
          rel('Node', 'id', 'NodeId', 'is identified by', 'OneToOne'),
          rel('Node', 'joined', 'Hub', 'joined', 'ManyToOne'),
          rel('Node', 'state', 'NodeState', 'is', 'ManyToOne'),
          rel('Node', 'expires_at', 'DateTime', 'expires at', 'ManyToOne'),
          rel('Node', 'last_seen_at', 'DateTime', 'was last seen at', 'ManyToOne'),
        ],
      },
      {
        concept: 'RetiredEntry', type: 'EntityType', description: 'One row of RETIRED.md: something ceased by hand, with how to bring it back', identify_by: ['retired_at', 'names'],
        annotations: { 'arra:file': 'RETIRED.md in the vault (or the data dir)' },
        relationships: [
          rel('RetiredEntry', 'retired_at', 'DateTime', 'was written at', 'ManyToOne'),
          rel('RetiredEntry', 'names', 'RetiredThing', 'names', 'ManyToOne'),
          rel('RetiredEntry', 'because', 'Reason', 'says why', 'ManyToOne'),
          { ...rel('RetiredEntry', 'successor', 'RetiredThing', 'names successor', 'ManyToOne', 'successor') },
          rel('RetiredEntry', 'recorded_in', 'Vault', 'is recorded in', 'ManyToOne'),
        ],
      },
    ],
  };
}

export interface SchemaGraph {
  nodes: Array<{ id: string; kind: 'EntityType' | 'ValueType' | 'BuiltIn'; label: string; description?: string; extends?: string[] }>;
  edges: Array<{ from: string; to: string; label: string; multiplicity?: string; kind: 'relationship' | 'extends' }>;
}

/** The same ontology as a graph: concepts are nodes, relationships and `extends` are edges. */
export function ontologyGraph(o: OssieOntology = arraOntology()): SchemaGraph {
  const nodes: SchemaGraph['nodes'] = o.ontology.map((c) => ({ id: c.concept, kind: c.type, label: c.concept, description: c.description, extends: c.extends }));
  const declared = new Set(nodes.map((n) => n.id));
  const edges: SchemaGraph['edges'] = [];
  const builtIn = (id: string) => { if (!declared.has(id)) { declared.add(id); nodes.push({ id, kind: 'BuiltIn', label: id }); } };
  for (const c of o.ontology) {
    for (const base of c.extends ?? []) { builtIn(base); edges.push({ from: c.concept, to: base, label: 'extends', kind: 'extends' }); }
    for (const r of c.relationships ?? []) for (const role of r.roles ?? []) {
      builtIn(role.concept);
      edges.push({ from: c.concept, to: role.concept, label: `${c.concept}.${r.name}`, multiplicity: r.multiplicity, kind: 'relationship' });
    }
  }
  return { nodes, edges };
}
