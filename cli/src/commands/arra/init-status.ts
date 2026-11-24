/** `arra init [dir]` (local, no server needed) and `arra status` (GET /api/arra/status). */

import { initArra } from "../../../../src/arra/init.ts";
import { callApi, fail, flag, parseArgs, printJson, table } from "./_api.ts";

export async function initCommand(args: string[]): Promise<number> {
  const p = parseArgs(args, ["hub", "reindex", "json"]);
  const vaultPath = flag(p, "vault");
  try {
    const result = initArra({
      dir: p.positional[0] ?? process.cwd(),
      name: flag(p, "name") && !p.flags.hub ? flag(p, "name") : undefined,
      hub: !!p.flags.hub,
      hubName: p.flags.hub ? flag(p, "name") : undefined,
      vaults: vaultPath ? [{ name: flag(p, "vault-name") ?? vaultPath.split("/").filter(Boolean).pop()!, path: vaultPath }] : [],
      from: flag(p, "from"),
      reindex: !!p.flags.reindex,
    });
    if (p.flags.json) { printJson(result); return result.indexed.ok ? 0 : 1; }
    console.log(`${result.created ? "created" : "already initialized"}: ${result.dataDir}`);
    console.log(`  name      ${result.config.name}${result.config.hub ? `  (hub: ${result.config.hub.name})` : ""}`);
    console.log(`  git repo  ${result.gitRepo ?? "no"} · .gitignore ${result.gitignore} · .envrc ${result.envrc}`);
    for (const v of result.config.vaults) console.log(`  vault     hub:${v.name} → ${v.path}`);
    for (const line of result.indexed.summary) console.log(`  index     ${line}`);
    if (result.copiedFrom) console.log(`  --from    ${result.copiedFrom.rows} rows copied from ${result.copiedFrom.from}`);
    if (result.exportLines.length) {
      console.log("\nnot a git repo: export these before starting arra here:");
      for (const line of result.exportLines) console.log(`  ${line}`);
    } else if (result.envrc !== "skipped") {
      console.log("\nnext: direnv allow   (then arra serve / your MCP uses this .arra)");
    }
    return result.indexed.ok ? 0 : 1;
  } catch (error) {
    return fail(error);
  }
}

type Status = {
  name: string | null; initialized: boolean; dataDir: string; dbPath: string;
  docs: { total: number; bySource: Record<string, number> };
  embedder: { provider: string; model: string; url: string | null };
  vaults: Array<{ name: string; path: string; sha: string | null; dirty: boolean | null }>;
  hubs: Array<{ name: string; url: string; nodeId: string; expiresAt: string | null; expired: boolean; lastSyncAt?: string }>;
  hub: { name: string; nodes: number; invitesOpen: number } | null;
  snapshots: Array<{ file: string; bytes: number }>;
};

export async function statusCommand(args: string[]): Promise<number> {
  try {
    const s = await callApi<Status>("GET", "/api/arra/status");
    if (args.includes("--json")) { printJson(s); return 0; }
    console.log(`arra ${s.name ?? "(not initialized: default data dir)"}`);
    console.log(`  data      ${s.dataDir}`);
    console.log(`  db        ${s.dbPath}`);
    console.log(`  embedder  ${s.embedder.provider} · ${s.embedder.model}`);
    console.log(`  docs      ${s.docs.total} · ${Object.entries(s.docs.bySource).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}`);
    if (s.hub) console.log(`  hub       ${s.hub.name} · ${s.hub.nodes} nodes · ${s.hub.invitesOpen} open invites`);
    if (s.vaults.length) {
      console.log("\nvaults");
      console.log(table(["source", "path", "sha", "dirty"], s.vaults.map((v) => [`hub:${v.name}`, v.path, v.sha?.slice(0, 8), String(v.dirty)])));
    }
    if (s.hubs.length) {
      console.log("\nhubs joined");
      console.log(table(["hub", "url", "node", "expires", "last sync"], s.hubs.map((h) => [h.name, h.url, h.nodeId, h.expired ? "expired" : h.expiresAt ?? "forever", h.lastSyncAt])));
    }
    if (s.snapshots.length) console.log(`\nsnapshots  ${s.snapshots.map((x) => x.file).join(", ")}`);
    return 0;
  } catch (error) {
    return fail(error);
  }
}
