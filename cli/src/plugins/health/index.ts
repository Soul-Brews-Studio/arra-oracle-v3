import type { InvokeContext, InvokeResult } from "../../plugin/types.ts";
import { apiFetch } from "../../lib/api.ts";

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const json = ctx.args.includes("--json");
  const res = await apiFetch("/api/health");
  if (!res.ok) return { ok: false, error: `Health check failed: HTTP ${res.status}` };
  const data = await res.json() as Record<string, any>;
  if (json) return { ok: true, output: JSON.stringify(data, null, 2) };
  const lines = [
    `Status:  ${data.status}`,
    `Server:  ${data.server}`,
    `Version: ${data.version}`,
    `Port:    ${data.port}`,
    `Oracle:  ${data.oracle}`,
  ];
  return { ok: true, output: lines.join("\n") };
}
