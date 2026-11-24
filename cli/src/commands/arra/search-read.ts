/**
 * `arra find <q>` / `arra search <q> --grouped` — results per source; `arra open <id>` — one doc.
 * (`arra search` and `arra read` stay the existing flat search and the read plugin; grouped
 * output is what `--grouped`, `self:` or `shared:` ask for.)
 */

import { callApi, fail, flag, parseArgs, printJson } from "./_api.ts";

type Hit = { n: number; id: string; title: string; score: number; snippet: string };
type Group = { source: string; ranking: string; results: Hit[] };
type Grouped = { query: string; scope: string; total: number; groups: Group[]; notes: string[] };

export function renderGrouped(r: Grouped): string {
  const out: string[] = [`${r.total} results for "${r.query}"${r.scope !== "all" ? ` (only ${r.scope})` : ""}`];
  for (const g of r.groups) {
    out.push("", `── ${g.source} · ${g.results.length} · ranked by ${g.ranking}`);
    if (!g.results.length) out.push("   (no match)");
    for (const h of g.results) out.push(`  ${String(h.n).padStart(2)}  ${h.score.toFixed(3)}  ${h.title}`, `      ${h.id}`);
  }
  if (r.notes.length) out.push("", ...r.notes.map((n) => `· ${n}`));
  return out.join("\n");
}

export async function findCommand(args: string[]): Promise<number> {
  const p = parseArgs(args.filter((a) => a !== "--grouped"), ["json"]);
  const q = p.positional.join(" ").trim();
  if (!q) { console.error('usage: arra find "<query>" [--limit N]   (prefix self: or shared: to narrow)'); return 1; }
  try {
    const r = await callApi<Grouped>("GET", `/api/arra/search?${new URLSearchParams({ q, limit: flag(p, "limit") ?? "10" })}`);
    if (p.flags.json) printJson(r); else console.log(renderGrouped(r));
    return 0;
  } catch (error) {
    return fail(error);
  }
}

export async function openCommand(args: string[]): Promise<number> {
  const p = parseArgs(args, ["json"]);
  const id = p.positional.join(" ").trim();
  if (!id) { console.error("usage: arra open <id>"); return 1; }
  try {
    const r = await callApi<{ from: string; doc: Record<string, string> }>("GET", `/api/arra/read?${new URLSearchParams({ id })}`);
    if (p.flags.json) { printJson(r); return 0; }
    console.log(`${r.doc.source ?? "hub"} · ${r.doc.id} · from ${r.from}${r.doc.created_by ? ` · by ${r.doc.created_by}` : ""}`);
    console.log("");
    console.log(r.doc.content);
    return 0;
  } catch (error) {
    return fail(error);
  }
}
