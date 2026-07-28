import type { InvokeContext, InvokeResult } from "../../plugin/types.ts";
import { apiFetch } from "../../lib/api.ts";

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const args = ctx.args;
  const json = args.includes("--json");
  const limit = args[args.indexOf("--limit") + 1] || "10";
  const type = args[args.indexOf("--type") + 1] || "all";
  const qs = `?limit=${limit}&type=${type}`;
  const res = await apiFetch(`/api/inbox${qs}`);
  if (!res.ok) return { ok: false, error: `Inbox failed: HTTP ${res.status}` };
  const data = await res.json() as Record<string, any>;
  if (json) return { ok: true, output: JSON.stringify(data, null, 2) };
  const files = (data.files || []) as Array<{ name: string; date?: string; type?: string }>;
  if (files.length === 0) return { ok: true, output: "Inbox empty." };
  const lines = [`${data.total || files.length} handoff(s):\n`];
  for (const f of files) {
    lines.push(`  ${f.date || "?"} ${f.name}`);
  }
  return { ok: true, output: lines.join("\n") };
}
