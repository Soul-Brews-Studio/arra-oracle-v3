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

This page draws the types of arra memory as a schema graph ("What arra stores"). By default it
shows only the entity types and their relationships; **show fields** adds the value types.
Built-ins such as `String` are never drawn, because each would only add one more dashed
`extends` line. Edge labels appear only in the overview, and only while there are 12 edges or
fewer. Tap a concept and its relationships are listed as sentences beside the canvas.

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

## Topology (`/hub#/topology`)

A live picture of the hub, drawn from `GET /api/arra/topology` and refreshed every 5 seconds.
It reads top to bottom: source of truth, then the hub (with the Ossie exit to its right), then
the machines that joined. Each box has at most three short lines, cut to fit the box. Lines
carry no labels. A plain-words legend under the drawing says what each colour and line style
means. Tap a machine to see its id, address, calls and refusals (with the HTTP code), and to
revoke it.

- **Truth:** the org vault (git) with its commit and last commit time. A dashed box says that
  private `ψ/` notes stay on each node, in that node's own `.arra/`, and never reach the hub.
- **Hub:** name, port, how many shared documents it serves, and who is viewing.
- **Nodes:** one box per joined node, coloured by state (active green, expired amber, revoked
  red), with last seen, calls, time left, and refused calls (403) when a revoked or expired
  node keeps calling. Click a box to revoke the node (owner only; writes a `RETIRED.md` row).
- **Strangers:** callers turned away with 401 (no token, an unknown token, a bad invite code)
  and callers from a public address (403). Counted in memory since the server started, so a
  stranger hammering the door never turns into disk writes.
- **Ossie:** the export as a one-way exit. It shows the in-process check (the validator's rules
  restated in `src/arra/ossie-check.ts`) and the last official validator run. When run with
  `ORACLE_DATA_DIR` set, `ossie-validate.sh` writes its result to
  `<data dir>/ossie-validation.json`. The box says "older export" when that run checked a
  different document than the one served now.

From another machine the tab shows only the public hub card (name, commit, active node count).
