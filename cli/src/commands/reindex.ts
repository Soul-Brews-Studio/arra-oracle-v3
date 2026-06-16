import { apiFetch } from "../lib/api.ts";

function takeFlagValue(args: string[], name: string): string | undefined {
  const eq = args.find(a => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx >= 0) return args[idx + 1];
  return undefined;
}

export async function reindex(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("arra-cli reindex [--repo-root <path>] [--retros] [--file <path>] [--no-wait]\n");
    console.log("Triggers the server-side SQLite/FTS indexer via POST /api/indexer/reindex.");
    console.log("\nOptions:");
    console.log("  --repo-root <path>   Source repo/vault root to scan (default: server resolution)");
    console.log("  --retros             Index only ψ/memory/retrospectives from repo-root (no smart-delete)");
    console.log("  --file <path>        Index one retrospective markdown file (implies --retros)");
    console.log("  --no-wait            Return after starting the server-side job");
    console.log("\nEnv:");
    console.log("  ORACLE_API           API base URL (default http://localhost:47778)");
    return 0;
  }

  const repoRoot = takeFlagValue(args, "--repo-root");
  const filePath = takeFlagValue(args, "--file");
  const scope = filePath ? "retro-file" : args.includes("--retros") ? "retros" : "all";
  const wait = !args.includes("--no-wait");

  const res = await apiFetch("/api/indexer/reindex", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repoRoot, filePath, scope, wait }),
  });
  const text = await res.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    // Keep raw text for non-JSON server errors.
  }

  if (!res.ok) {
    console.error(typeof payload === "string" ? payload : JSON.stringify(payload, null, 2));
    return 1;
  }

  console.log(typeof payload === "string" ? payload : JSON.stringify(payload, null, 2));
  return 0;
}
