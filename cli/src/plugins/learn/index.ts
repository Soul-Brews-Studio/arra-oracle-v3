// arra-cli learn "<pattern>" [--concepts a,b] [--source s]
// Calls: POST /api/learn { pattern, concepts?, source? }
// Note: issue #770 listed this as POST /api/muninn_learn — using actual POST /api/learn route

import type { InvokeContext, InvokeResult } from "../../plugin/types.ts";
import { apiFetch } from "../../lib/api.ts";

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const args = ctx.args;

  let pattern = "";
  let concepts: string[] | undefined;
  let source: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--concepts" && args[i + 1]) {
      concepts = args[++i].split(",").map(c => c.trim()).filter(Boolean);
    } else if (args[i] === "--source" && args[i + 1]) {
      source = args[++i];
    } else if (!args[i].startsWith("--")) {
      pattern = args[i];
    }
  }

  if (!pattern) {
    return { ok: false, error: 'Usage: arra-cli learn "<pattern>" [--concepts a,b] [--source s]' };
  }

  const body: Record<string, unknown> = { pattern };
  if (concepts?.length) body.concepts = concepts;
  if (source) body.source = source;

  const res = await apiFetch("/api/learn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    return { ok: false, error: `Learn failed: ${text}` };
  }

  const data = await res.json() as any;
  const id = data.id ?? data.docId ?? "unknown";
  return { ok: true, output: `Learned: ${id}\n  "${pattern}"` };
}
