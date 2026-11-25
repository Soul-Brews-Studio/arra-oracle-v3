/** Shared plumbing for the `arra` vault/hub commands: one JSON call, flag parsing, output. */

import { apiFetch } from "../../lib/api.ts";

export async function callApi<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null) as (T & { error?: string }) | null;
  if (!res.ok || !data) {
    const message = data && typeof data === "object" && "error" in data ? String(data.error) : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data;
}

export interface Parsed { positional: string[]; flags: Record<string, string | true> }

/** `--a b --c --d=e x y` → { flags: {a:"b", c:true, d:"e"}, positional: [x, y] }. */
export function parseArgs(args: string[], booleans: string[] = []): Parsed {
  const out: Parsed = { positional: [], flags: {} };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) { out.positional.push(arg); continue; }
    const eq = arg.indexOf("=");
    if (eq > 0) { out.flags[arg.slice(2, eq)] = arg.slice(eq + 1); continue; }
    const name = arg.slice(2);
    const next = args[i + 1];
    if (booleans.includes(name) || next === undefined || next.startsWith("--")) out.flags[name] = true;
    else { out.flags[name] = next; i += 1; }
  }
  return out;
}

export function flag(p: Parsed, name: string): string | undefined {
  const v = p.flags[name];
  return typeof v === "string" ? v : undefined;
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

/** Left-aligned table with a header row; empty cells print as "-". */
export function table(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const cells = [headers, ...rows.map((r) => r.map((c) => (c === null || c === undefined || c === "" ? "-" : String(c))))];
  const widths = headers.map((_, i) => Math.max(...cells.map((r) => (r[i] ?? "").length)));
  return cells.map((r) => r.map((c, i) => (c ?? "").padEnd(widths[i])).join("  ").trimEnd()).join("\n");
}

export function fail(error: unknown): number {
  console.error(`\x1b[31m✗\x1b[0m ${error instanceof Error ? error.message : String(error)}`);
  return 1;
}
