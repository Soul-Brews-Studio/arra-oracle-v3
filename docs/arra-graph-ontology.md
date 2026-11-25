# arra graph and ontology views (#3110)

The hub UI (`/hub`, served by `arra serve` or `arra serve --hub`, owner only) has two pages that
draw what an arra remembers.

## Graph (`/hub#/graph`)

The nodes are documents, concepts, sources (`self`, `hub:<name>`), vaults, hub nodes, and
`RETIRED.md` rows. The edges are named after the ontology's relationships:

| edge | from → to | where it comes from |
|---|---|---|
| `tagged_with` | Document → Concept | `oracle_documents.concepts` |
| `comes_from` | Document → Source | `oracle_documents.origin` |
| `superseded_by` | Document → Document | `oracle_documents.superseded_by` (MCP `arra_supersede`) |
| `synced_from` | Source → Vault | `arra.json` vaults, `hubs.json` |
| `joined` | Node → Vault | `hub-state.json` (hub only) |
| `recorded_in` / `retires` | RetiredEntry → Vault / Node | `RETIRED.md` rows |

You can filter by source and choose how many documents to draw (newest first). Clicking a
document opens it (`/api/arra/read`); clicking any other node lights up its links. Past a dozen
documents, the graph only draws concepts that two or more documents share, at most the 60 most
used; the page says how many it left out. API: `GET /api/arra/graph?source=&limit=`.
CLI: `arra graph`.

## Ontology (`/hub#/ontology`)

This page draws the types of arra memory as a schema graph: entity types, value types, the
built-ins they extend, and labelled relationships. Click a concept to read its relationships
as sentences.

The ontology is written as an **Apache Ossie** ontology document. Ossie (incubating) was
formerly Open Semantic Interchange; see [apache/ossie](https://github.com/apache/ossie),
`ontology/ontology.md`, version `0.3.0.dev0`. Ossie has two layers:

- The **core spec** (`core-spec/spec.md`) models BI semantic models: datasets (tables),
  relationships (foreign keys), fields, and metrics with SQL expressions.
- The **ontology spec** models a domain as concepts (`EntityType` / `ValueType`, with
  `extends` and `identify_by`) and the relationships each concept plays the first role in.
  Each relationship has roles, an optional `ManyToOne` / `OneToOne` multiplicity, and
  `verbalizes` patterns such as `{Document} is tagged with {Concept}`. `annotations` hold
  anything the spec does not model.

arra uses the ontology layer. The core layer does not apply, because arra has no datasets or
metrics to exchange.

```
GET /api/arra/ontology              # the Ossie document (format=ossie is the default)
GET /api/arra/ontology?format=graph # the schema graph the UI draws
arra ontology                       # table of concepts and relationships
arra ontology --ossie > arra.ontology.json
bash scripts/arra-proof/ossie-validate.sh   # official validator; ORACLE_API=... checks a running arra
```

The export is returned as a raw response, so the server's `{success, data}` envelope never
wraps it. The validator caught this: through HTTP the first version failed with
`Additional properties are not allowed ('data', 'success' …)`.
