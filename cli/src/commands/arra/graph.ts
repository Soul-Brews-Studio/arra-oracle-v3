/** `arra ontology [--ossie|--graph]` (GET /api/arra/ontology) and `arra graph [--source s]` (GET /api/arra/graph). */

import { callApi, fail, flag, parseArgs, printJson, table } from "./_api.ts";

export async function ontologyCommand(args: string[]): Promise<number> {
  const p = parseArgs(args, ["ossie", "graph", "json"]);
  try {
    if (p.flags.graph) { printJson(await callApi("GET", "/api/arra/ontology?format=graph")); return 0; }
    const doc = await callApi<{ name: string; ontology: Array<{ concept: string; type: string; relationships?: Array<{ name: string }> }> }>("GET", "/api/arra/ontology?format=ossie");
    if (p.flags.ossie || p.flags.json) { printJson(doc); return 0; }
    console.log(`${doc.name} — Apache Ossie ontology (print the document with --ossie)\n`);
    console.log(table(["concept", "type", "relationships"], doc.ontology.map((c) => [c.concept, c.type, (c.relationships ?? []).map((r) => r.name).join(", ")])));
    return 0;
  } catch (error) { return fail(error); }
}

export async function graphCommand(args: string[]): Promise<number> {
  const p = parseArgs(args, ["json"]);
  const query = new URLSearchParams();
  const source = flag(p, "source"); const limit = flag(p, "limit");
  if (source) query.set("source", source);
  if (limit) query.set("limit", limit);
  try {
    const g = await callApi<{ nodes: Array<{ kind: string }>; edges: Array<{ kind: string }>; sources: string[]; omitted: { documents: number; concepts: number } }>("GET", `/api/arra/graph${query.size ? `?${query}` : ""}`);
    if (p.flags.json) { printJson(g); return 0; }
    const count = (xs: Array<{ kind: string }>) => Object.entries(xs.reduce<Record<string, number>>((a, x) => ({ ...a, [x.kind]: (a[x.kind] ?? 0) + 1 }), {}));
    console.log(table(["nodes", "count"], count(g.nodes)));
    console.log(`\n${table(["edges", "count"], count(g.edges))}`);
    console.log(`\nsources ${g.sources.join(", ") || "-"} · not shown: ${g.omitted.documents} documents, ${g.omitted.concepts} rarely used concepts`);
    return 0;
  } catch (error) { return fail(error); }
}
