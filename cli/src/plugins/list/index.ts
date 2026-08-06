// arra-cli list [--type X] [--limit N]
// Calls: GET /api/list?type=X&limit=N
// Note: issue #770 listed this as /api/muninn_list — using actual GET /api/list route

import type { InvokeContext, InvokeResult } from "../../plugin/types.ts";
import { apiFetch } from "../../lib/api.ts";

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const args = ctx.args;

  let type = "all";
  let limit = 20;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--type" && args[i + 1]) {
      type = args[++i];
    } else if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[++i], 10) || 20;
    }
  }

  const params = new URLSearchParams({ type, limit: String(limit) });
  const res = await apiFetch(`/api/list?${params}`);

  if (!res.ok) {
    return { ok: false, error: `List failed: HTTP ${res.status}` };
  }

  const data = await res.json() as any;
  const docs: any[] = data.documents ?? data.results ?? [];

  if (docs.length === 0) {
    return { ok: true, output: `No documents found (type: ${type})` };
  }

  const total = data.total ?? docs.length;
  const lines: string[] = [`${total} documents (showing ${docs.length}, type: ${type}):\n`];

  for (const d of docs) {
    const preview = (d.content ?? d.pattern ?? "").slice(0, 80).replace(/\n/g, " ");
    lines.push(`[${d.type ?? "?"}] ${d.id}`);
    lines.push(`  ${preview}`.trimEnd());
    lines.push("");
  }

  return { ok: true, output: lines.join("\n") };
}
