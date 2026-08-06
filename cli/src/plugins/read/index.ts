// arra-cli read <id-or-path>
// Calls: GET /api/read?id=<id>  — when arg has no path separators
//        GET /api/read?file=<path> — when arg looks like a file path
// Note: issue #770 listed this as /api/muninn_read — using actual GET /api/read route

import type { InvokeContext, InvokeResult } from "../../plugin/types.ts";
import { apiFetch } from "../../lib/api.ts";

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const target = ctx.args.find(a => !a.startsWith("--"));

  if (!target) {
    return { ok: false, error: "Usage: arra-cli read <id-or-path>" };
  }

  // Treat as file path if it contains / or . (looks like a path), otherwise as id
  const isPath = target.includes("/") || target.includes("\\") || target.includes(".");
  const params = new URLSearchParams(isPath ? { file: target } : { id: target });

  const res = await apiFetch(`/api/read?${params}`);

  if (res.status === 404) {
    return { ok: false, error: `Not found: ${target}` };
  }
  if (!res.ok) {
    return { ok: false, error: `Read failed: HTTP ${res.status}` };
  }

  const data = await res.json() as any;

  if (data.error) {
    return { ok: false, error: data.error };
  }

  const lines: string[] = [];
  if (data.id) lines.push(`ID:   ${data.id}`);
  if (data.type) lines.push(`Type: ${data.type}`);
  if (data.source_file) lines.push(`File: ${data.source_file}`);
  if (data.concepts?.length) lines.push(`Tags: ${data.concepts.join(", ")}`);
  lines.push("");
  lines.push(data.content ?? data.pattern ?? "(no content)");

  return { ok: true, output: lines.join("\n") };
}
