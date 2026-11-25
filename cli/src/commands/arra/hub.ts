/**
 * `arra hub invite|nodes|revoke`, `arra join`, `arra hubs [--leave n]`, `arra discover`,
 * `arra retire`, `arra serve --hub` — callers of /api/arra (serve --hub checks, then serves).
 */

import { readConfig } from "../../../../src/arra/state.ts";
import { serveCommand } from "../serve.ts";
import { callApi, fail, flag, parseArgs, printJson, table } from "./_api.ts";

type Node = { id: string; label: string; state: string; left: string; joinedAt: string; lastSeenAt: string | null; lastIp: string | null; calls: number };
type Invite = { label: string; grant: string; state: string; codeExpiresAt: string; usedBy: string | null };

export async function hubCommand(args: string[]): Promise<number> {
  const p = parseArgs(args, ["json"]);
  const sub = p.positional[0] ?? "nodes";
  try {
    if (sub === "invite") {
      const r = await callApi<{ invite: { hub: string; code: string; label: string; grant: string; codeExpiresAt: string } }>("POST", "/api/arra/hub/invite", { for: flag(p, "for") ?? "1h", label: flag(p, "label") });
      if (p.flags.json) { printJson(r); return 0; }
      const i = r.invite;
      console.log(`invite for hub ${i.hub} · label ${i.label} · node lasts ${i.grant}`);
      console.log(`  code   ${i.code}   (one use, until ${i.codeExpiresAt})`);
      console.log(`  on the other machine:  arra join <this hub url> --code ${i.code}`);
      return 0;
    }
    if (sub === "nodes") {
      const r = await callApi<{ nodes: Node[]; invites: Invite[] }>("GET", "/api/arra/hub/nodes");
      if (p.flags.json) { printJson(r); return 0; }
      console.log(r.nodes.length ? table(["node", "label", "state", "expires", "last seen", "ip", "calls"], r.nodes.map((n) => [n.id, n.label, n.state, n.left, n.lastSeenAt, n.lastIp, n.calls])) : "no nodes joined yet");
      const open = r.invites.filter((i) => i.state === "open");
      if (open.length) console.log(`\n${open.length} open invite(s): ${open.map((i) => `${i.label} (${i.grant})`).join(", ")}`);
      return 0;
    }
    if (sub === "revoke") {
      const id = p.positional[1];
      if (!id) { console.error('usage: arra hub revoke <node-id> [--why "..."] [--successor x]'); return 1; }
      const r = await callApi<Record<string, any>>("POST", "/api/arra/hub/revoke", { id, why: flag(p, "why"), successor: flag(p, "successor") });
      if (p.flags.json) { printJson(r); return 0; }
      console.log(r.alreadyRevoked ? `${id} was already revoked` : `revoked ${id} at ${r.revokedAt}`);
      if (r.retired) console.log(`  RETIRED row → ${r.retired.file}${r.retired.committed ? " (committed)" : ""}`);
      return 0;
    }
    console.error("usage: arra hub invite [--for 15m|1h|7d|forever] [--label x] | nodes | revoke <id>");
    return 1;
  } catch (error) {
    return fail(error);
  }
}

export async function joinCommand(args: string[]): Promise<number> {
  const p = parseArgs(args, ["json"]);
  const url = p.positional[0];
  const code = flag(p, "code");
  if (!url || !code) { console.error("usage: arra join <hub url> --code <code> [--label name]"); return 1; }
  try {
    const r = await callApi<{ joined: { hub: string; url: string; nodeId: string; expiresAt: string | null; grant: string } }>("POST", "/api/arra/join", { url, code, label: flag(p, "label") });
    if (p.flags.json) { printJson(r); return 0; }
    console.log(`joined hub ${r.joined.hub} at ${r.joined.url} as ${r.joined.nodeId} · ${r.joined.expiresAt ? `until ${r.joined.expiresAt}` : "no expiry"}`);
    console.log("  next: arra sync   (pull its shared vault into this arra as hub:" + r.joined.hub + ")");
    return 0;
  } catch (error) {
    return fail(error);
  }
}

export async function hubsCommand(args: string[]): Promise<number> {
  const p = parseArgs(args, ["json"]);
  try {
    const leave = flag(p, "leave");
    const r = leave ? await callApi<Record<string, any>>("POST", "/api/arra/hubs/leave", { name: leave }) : await callApi<Record<string, any>>("GET", "/api/arra/hubs");
    if (p.flags.json) { printJson(r); return 0; }
    if (leave) { console.log(`left ${r.left}: ${r.note}`); return 0; }
    const hubs = r.hubs as Array<{ name: string; url: string; nodeId: string; expiresAt: string | null; expired: boolean; lastSyncAt?: string }>;
    console.log(hubs.length ? table(["hub", "url", "node", "expires", "last sync"], hubs.map((h) => [h.name, h.url, h.nodeId, h.expired ? "expired" : h.expiresAt ?? "forever", h.lastSyncAt])) : "no hubs joined");
    return 0;
  } catch (error) {
    return fail(error);
  }
}

export async function discoverCommand(args: string[]): Promise<number> {
  const p = parseArgs(args, ["json"]);
  try {
    const q = new URLSearchParams();
    if (flag(p, "port")) q.set("port", flag(p, "port")!);
    if (flag(p, "hosts")) q.set("hosts", flag(p, "hosts")!);
    const r = await callApi<{ port: number; probed: number; hubs: Array<{ hub: string; url: string; nodes: number; sha: string | null }> }>("GET", `/api/arra/discover?${q}`);
    if (p.flags.json) { printJson(r); return 0; }
    console.log(`probed ${r.probed} tailnet hosts on :${r.port}`);
    console.log(r.hubs.length ? table(["hub", "url", "nodes", "vault sha"], r.hubs.map((h) => [h.hub, h.url, h.nodes, h.sha?.slice(0, 8)])) : "no hub found");
    return 0;
  } catch (error) {
    return fail(error);
  }
}

export async function retireCommand(args: string[]): Promise<number> {
  const p = parseArgs(args, ["json"]);
  const thing = p.positional.join(" ").trim();
  if (!thing || !flag(p, "successor") || !flag(p, "why")) { console.error('usage: arra retire <thing> --successor <x|nothing> --why "..." [--back "how to bring it back"]'); return 1; }
  try {
    const r = await callApi<{ retired: { file: string; row: string; committed: boolean; pushed: boolean } }>("POST", "/api/arra/retire", { thing, successor: flag(p, "successor"), why: flag(p, "why"), back: flag(p, "back"), vault: flag(p, "vault") });
    if (p.flags.json) { printJson(r); return 0; }
    console.log(`retired → ${r.retired.file}${r.retired.committed ? " (committed" + (r.retired.pushed ? ", pushed)" : ")") : ""}`);
    console.log(`  ${r.retired.row}`);
    return 0;
  } catch (error) {
    return fail(error);
  }
}

/** `arra serve --hub`: refuse unless this data dir was made a hub, then serve as usual. */
export async function serveHubCommand(args: string[]): Promise<number> {
  const hub = readConfig()?.hub;
  if (!hub) { console.error("not a hub: run arra init --hub --name <name> --vault <path> [dir] and point ORACLE_DATA_DIR at it"); return 1; }
  console.log(`serving hub ${hub.name} · door /api/federation (tailnet/LAN + node token)`);
  return serveCommand(["serve", ...args.filter((a) => a !== "--hub")]);
}
