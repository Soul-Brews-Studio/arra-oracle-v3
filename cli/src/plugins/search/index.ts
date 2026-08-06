// arra-cli search "<q>" [--limit N] [--type X]
// Calls: GET /api/search?q=<q>&limit=N&type=X
// Note: issue #770 listed this as POST /api/muninn_search — using actual GET /api/search route

import type { InvokeContext, InvokeResult } from "../../plugin/types.ts";
import { apiFetch } from "../../lib/api.ts";

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const args = ctx.args;

  let query = "";
  let limit = 10;
  let type = "all";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[++i], 10) || 10;
    } else if (args[i] === "--type" && args[i + 1]) {
      type = args[++i];
    } else if (!args[i].startsWith("--")) {
      query = args[i];
    }
  }

  if (!query) {
    return { ok: false, error: 'Usage: arra-cli search "<query>" [--limit N] [--type X]' };
  }

  const params = new URLSearchParams({ q: query, limit: String(limit), type });
  const res = await apiFetch(`/api/search?${params}`);

  if (!res.ok) {
    return { ok: false, error: `Search failed: HTTP ${res.status}` };
  }

  const data = await res.json() as any;
  const results: any[] = data.results ?? [];

  if (results.length === 0) {
    return { ok: true, output: `No results for "${query}"` };
  }

  const lines: string[] = [`Found ${data.total ?? results.length} results for "${query}":\n`];
  for (const r of results) {
    lines.push(`[${r.type}] ${r.id}`);
    lines.push(`  ${r.content?.slice(0, 120).replace(/\n/g, " ") ?? ""}`.trimEnd());
    if (r.source_file) lines.push(`  → ${r.source_file}`);
    lines.push("");
  }

  return { ok: true, output: lines.join("\n") };
}
