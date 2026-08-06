// arra-cli trace [query] [--limit N]
// Calls: GET /api/traces?query=<query>&limit=N
// Note: issue #770 listed this as /api/muninn_trace — using GET /api/traces (list/search).
// There is no HTTP POST endpoint to create traces; use the MCP tool muninn_trace for that.

import type { InvokeContext, InvokeResult } from "../../plugin/types.ts";
import { apiFetch } from "../../lib/api.ts";

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const args = ctx.args;

  let query = "";
  let limit = 20;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[++i], 10) || 20;
    } else if (!args[i].startsWith("--")) {
      query = args[i];
    }
  }

  const params = new URLSearchParams({ limit: String(limit) });
  if (query) params.set("query", query);

  const res = await apiFetch(`/api/traces?${params}`);

  if (!res.ok) {
    return { ok: false, error: `Trace list failed: HTTP ${res.status}` };
  }

  const data = await res.json() as any;
  const traces: any[] = data.traces ?? data.results ?? [];

  if (traces.length === 0) {
    const label = query ? `"${query}"` : "any traces";
    return { ok: true, output: `No traces found for ${label}` };
  }

  const total = data.total ?? traces.length;
  const header = query
    ? `${total} traces matching "${query}" (showing ${traces.length}):\n`
    : `${total} traces (showing ${traces.length}):\n`;
  const lines: string[] = [header];

  for (const t of traces) {
    lines.push(`[${t.id}] ${t.query ?? t.title ?? "(no query)"}`);
    if (t.status) lines.push(`  status: ${t.status}`);
    if (t.created_at ?? t.createdAt) {
      const d = new Date(t.created_at ?? t.createdAt).toISOString().slice(0, 16).replace("T", " ");
      lines.push(`  ${d}`);
    }
    lines.push("");
  }

  return { ok: true, output: lines.join("\n") };
}
