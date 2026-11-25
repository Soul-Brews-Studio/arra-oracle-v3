/** `arra share`, `arra sync`, `arra snapshot create|push|pull|list` — callers of /api/arra. */

import fs from "node:fs";
import path from "node:path";
import { callApi, fail, flag, parseArgs, printJson, table } from "./_api.ts";

type Shared = { vault: string; rel: string; sha: string | null; pushed: boolean; created: boolean };

export async function shareCommand(args: string[]): Promise<number> {
  const p = parseArgs(args, ["json"]);
  const target = p.positional.join(" ").trim();
  const text = flag(p, "text");
  if (!target && !text) {
    console.error("usage: arra share <doc-id | file.md> [--vault <name|hub:name>] [--title T]   or   arra share --text \"...\"");
    return 1;
  }
  const body: Record<string, unknown> = { vault: flag(p, "vault"), title: flag(p, "title") };
  if (text) body.text = text;
  else if (fs.existsSync(target)) body.file = path.resolve(target);
  else body.id = target;
  try {
    const r = await callApi<{ shared: Shared }>("POST", "/api/arra/share", body);
    if (p.flags.json) { printJson(r); return 0; }
    const s = r.shared;
    console.log(`${s.created ? "shared" : "already in vault"} → hub:${s.vault}  ${s.rel}`);
    console.log(`  commit ${s.sha?.slice(0, 8) ?? "-"} · ${s.pushed ? "pushed" : "local commit (no upstream, or push skipped)"}`);
    return 0;
  } catch (error) {
    return fail(error);
  }
}

type SyncRow = { vault: string; sha: string | null; pulled: string; files: number; added: number; updated: number; unchanged: number; removed: number; queued: number; error?: string };

export async function syncCommand(args: string[]): Promise<number> {
  const p = parseArgs(args, ["json"]);
  try {
    const r = await callApi<{ vaults: SyncRow[]; hubs?: SyncRow[] }>("POST", "/api/arra/sync", { vault: flag(p, "vault") ?? p.positional[0] });
    if (p.flags.json) { printJson(r); return 0; }
    const rows = [...r.vaults, ...(r.hubs ?? [])];
    if (!rows.length) { console.log("nothing to sync: no vault connected and no hub joined"); return 0; }
    console.log(table(["source", "pulled", "sha", "files", "added", "updated", "same", "removed", "vectors queued"],
      rows.map((v) => [v.vault, v.pulled, v.sha?.slice(0, 8), v.files, v.added, v.updated, v.unchanged, v.removed, v.queued])));
    for (const v of rows) if (v.error) console.error(`  ${v.vault}: ${v.error}`);
    return rows.some((v) => v.pulled === "failed") ? 1 : 0;
  } catch (error) {
    return fail(error);
  }
}

export async function snapshotCommand(args: string[]): Promise<number> {
  const p = parseArgs(args, ["json"]);
  const action = p.positional[0] ?? "list";
  const where = p.positional[1];
  const body = { vault: flag(p, "vault"), file: flag(p, "file"), dest: action === "push" ? where : undefined, src: action === "pull" ? where : undefined };
  try {
    const r = action === "list"
      ? await callApi<Record<string, any>>("GET", "/api/arra/snapshots")
      : await callApi<Record<string, any>>("POST", `/api/arra/snapshot/${action}`, body).catch((e) => { throw e; });
    if (p.flags.json) { printJson(r); return r.ok === false ? 1 : 0; }
    if (action === "create") console.log(`created ${r.snapshot.file}  (model ${r.snapshot.model}, vault ${r.snapshot.sha.slice(0, 12)}, parts ${r.snapshot.parts.join("+") || "none"})`);
    else if (action === "push") console.log(`pushed ${r.pushed.file} → ${r.pushed.to ?? r.pushed.hub} (${r.pushed.bytes} bytes)`);
    else if (action === "pull") console.log(r.pull.matched ? `restored ${r.pull.file}: ${r.pull.restored.join(", ") || "manifest only"}` : `no matching snapshot: ${r.pull.reason}`);
    else console.log(r.snapshots.length ? table(["file", "bytes"], r.snapshots.map((s: { file: string; bytes: number }) => [s.file, s.bytes])) : `no snapshots in ${r.dir}`);
    return 0;
  } catch (error) {
    return fail(error);
  }
}
