// arra-cli learn "<pattern>" [--concepts a,b] [--source s] [--project p]
// Calls: POST /api/learn { pattern, concepts?, source?, project? }
// Note: issue #770 listed this as POST /api/muninn_learn — using actual POST /api/learn route

import type { InvokeContext, InvokeResult } from "../../plugin/types.ts";
import { apiFetch } from "../../lib/api.ts";

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const args = ctx.args;

  let pattern = "";
  let concepts: string[] | undefined;
  let source: string | undefined;
  let project: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--concepts" && args[i + 1]) {
      concepts = args[++i].split(",").map(c => c.trim()).filter(Boolean);
    } else if (args[i] === "--source" && args[i + 1]) {
      source = args[++i];
    } else if (args[i] === "--project") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        return { ok: false, error: "--project requires a value" };
      }
      project = value;
      i++;
    } else if (!args[i].startsWith("--")) {
      pattern = args[i];
    }
  }

  if (!pattern) {
    return { ok: false, error: 'Usage: arra-cli learn "<pattern>" [--concepts a,b] [--source s] [--project p]' };
  }

  const body: Record<string, unknown> = { pattern };
  if (concepts?.length) body.concepts = concepts;
  if (source) body.source = source;
  if (project) body.project = project;

  const res = await apiFetch("/api/learn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    return { ok: false, error: `Learn failed: ${text}` };
  }

  const data = await res.json() as Record<string, unknown>;
  const id = data.id ?? data.docId ?? "unknown";
  const file = typeof data.file === "string" ? `\n  file: ${data.file}` : "";
  return { ok: true, output: `Learned: ${String(id)}${file}\n  "${pattern}"` };
}
