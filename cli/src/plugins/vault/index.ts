import type { InvokeContext, InvokeResult } from "../../plugin/types.ts";
import { apiFetch } from "../../lib/api.ts";

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const sub = ctx.args[0] || "status";
  const json = ctx.args.includes("--json");

  if (sub === "sync") {
    const res = await apiFetch("/api/vault/sync", { method: "POST" });
    if (!res.ok) return { ok: false, error: `Vault sync failed: HTTP ${res.status}` };
    const data = await res.json() as Record<string, any>;
    if (json) return { ok: true, output: JSON.stringify(data, null, 2) };
    return { ok: true, output: `Vault synced: ${data.added || 0} added, ${data.updated || 0} updated, ${data.total || "?"} total.` };
  }

  if (sub === "status") {
    const res = await apiFetch("/api/stats");
    if (!res.ok) return { ok: false, error: `Stats failed: HTTP ${res.status}` };
    const data = await res.json() as Record<string, any>;
    if (json) return { ok: true, output: JSON.stringify(data, null, 2) };
    const lines = [
      `Vault: ${data.total || 0} docs`,
      `Vectors: ${(data.vectors || []).map((v: any) => `${v.key}=${v.count}`).join(", ") || "none"}`,
      `Vault repo: ${data.vault_repo || "(not set)"}`,
    ];
    return { ok: true, output: lines.join("\n") };
  }

  return { ok: false, error: `Unknown subcommand: ${sub}. Use: sync | status` };
}
