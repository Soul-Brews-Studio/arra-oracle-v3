import { apiFetch } from "../lib/api.ts";

function printSearchHelp(): void {
  console.log("Usage: arra-cli search <query> [--type X] [--limit N] [--offset N] [--project P] [--json]");
  console.log("Examples:");
  console.log("  arra-cli search \"oracle\" --type all --limit 20");
}

function toPositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, value);
}

function parseSearchArgs(args: string[]) {
  let query = "";
  const opts = {
    type: "all",
    limit: 10,
    offset: 0,
    project: undefined as string | undefined,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
    if (arg === "--type" && args[i + 1]) {
      opts.type = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--limit" && args[i + 1]) {
      opts.limit = toPositiveInt(args[i + 1], opts.limit);
      i += 1;
      continue;
    }
    if (arg === "--offset" && args[i + 1]) {
      opts.offset = toPositiveInt(args[i + 1], opts.offset);
      i += 1;
      continue;
    }
    if (arg === "--project" && args[i + 1]) {
      opts.project = args[i + 1];
      i += 1;
      continue;
    }

    if (!arg.startsWith("--") && !query) {
      query = arg;
      continue;
    }
    if (!arg.startsWith("--")) {
      query = `${query} ${arg}`.trim();
    }
  }

  return {
    help: false,
    query,
    type: opts.type,
    limit: opts.limit,
    offset: opts.offset,
    project: opts.project,
    json: args.includes("--json"),
  };
}

function renderRows(results: Array<Record<string, unknown>>): string {
  const lines: string[] = [];
  for (const result of results) {
    const id = result.id ?? result.docId ?? "unknown";
    const type = result.type ?? "result";
    const content = String(result.content ?? result.pattern ?? result.text ?? "").replace(/\s+/g, " ").slice(0, 120);
    const source = result.source_file ?? result.path ?? "";
    lines.push(`[${type}] ${id}`);
    if (source) lines.push(`  ${source}`);
    if (content) lines.push(`  ${content}`);
    lines.push("");
  }
  return lines.join("\n");
}

export async function searchCommand(args: string[]): Promise<number> {
  const parsed: { help: boolean; query?: string; type: string; limit: number; offset: number; project?: string; json: boolean } =
    parseSearchArgs(args);

  if (parsed.help) {
    printSearchHelp();
    return 0;
  }
  if (!parsed.query) {
    printSearchHelp();
    console.error("Missing query argument");
    return 1;
  }

  const query = new URLSearchParams({
    q: parsed.query,
    limit: String(parsed.limit),
    offset: String(parsed.offset),
    type: parsed.type,
  });
  if (parsed.project) query.set("project", parsed.project);

  const res = await apiFetch(`/api/search?${query}`);
  const data = await res.json().catch(() => null) as Record<string, unknown> | null;

  if (!res.ok) {
    const message = (data && typeof data === "object" && "error" in data) ? String(data.error) : `HTTP ${res.status}`;
    console.error(`search failed: ${message}`);
    return 1;
  }

  if (!data || typeof data !== "object") {
    console.error("search returned an invalid response");
    return 1;
  }

  const results = Array.isArray(data.results) ? data.results as Array<Record<string, unknown>> : [];
  const total = typeof data.total === "number" ? data.total : results.length;

  if (parsed.json) {
    console.log(JSON.stringify(data, null, 2));
    return 0;
  }

  if (results.length === 0) {
    console.log(`No results for "${parsed.query}"`);
    return 0;
  }

  console.log(`Found ${total} results for "${parsed.query}":`);
  console.log("");
  console.log(renderRows(results));

  return 0;
}
