import { apiFetch } from "../lib/api.ts";

interface AskPayload {
  question: string;
  limit: number;
  type?: string;
  project?: string;
  cwd?: string;
  model?: string;
  asOf?: string;
  llm?: boolean;
}

function printAskHelp(): void {
  console.log("Usage: arra-cli ask <question> [--limit N] [--type X] [--model M] [--project P] [--as-of DATE] [--no-llm] [--json]");
  console.log("Examples:");
  console.log("  arra-cli ask \"how does sleep mode work?\"");
  console.log("  arra-cli ask \"what changed?\" --limit 5 --type pattern --project cli");
}

function toInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAskArgs(args: string[]): { payload: AskPayload; json: boolean } {
  const payload: AskPayload = { question: "", limit: 8, type: "all" };
  const json = args.includes("--json");
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) continue;
    if (arg === "--limit" && args[i + 1]) {
      payload.limit = toInt(args[i + 1], payload.limit);
      i += 1;
      continue;
    }
    if (arg === "--type" && args[i + 1]) {
      payload.type = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--project" && args[i + 1]) {
      payload.project = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--cwd" && args[i + 1]) {
      payload.cwd = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--model" && args[i + 1]) {
      payload.model = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--as-of" && args[i + 1]) {
      payload.asOf = args[i + 1];
      i += 1;
      continue;
    }
    else if (arg === "--no-llm") payload.llm = false;
    else if (!arg.startsWith("--")) {
      positional.push(arg);
      payload.question = positional.join(" ");
    }
  }

  return { payload, json };
}

function printResult(text: string, data: Record<string, unknown>): void {
  if (text) console.log(text);
  if (Array.isArray(data.warnings)) {
    for (const warning of data.warnings as unknown[]) {
      if (typeof warning === "string") console.log(`⚠ ${warning}`);
    }
  }
  if (Array.isArray(data.sources)) {
    const sources = data.sources as Array<Record<string, unknown>>;
    if (sources.length) {
      console.log("\nSources:");
      for (let i = 0; i < sources.length; i += 1) {
        const source = sources[i];
        const id = source.id ?? source.docId ?? i + 1;
        const score = source.score !== undefined ? ` (${source.score})` : "";
        const path = source.source_file ?? source.path ?? "";
        const snippet = source.content ?? source.text ?? "";
        const title = source.title ?? source.name ?? "source";
        if (typeof id === "string" || typeof id === "number") console.log(`[${i + 1}] ${title}${score}`);
        if (path) console.log(`    ${path}`);
        if (snippet) console.log(`    ${String(snippet).replace(/\s+/g, " ").slice(0, 100)}`);
      }
    }
  }
}

export async function askCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    printAskHelp();
    return 0;
  }

  const { payload, json } = parseAskArgs(args);

  if (!payload.question) {
    printAskHelp();
    console.error("Missing question argument");
    return 1;
  }

  payload.question = payload.question.trim();
  payload.llm = payload.llm === false ? false : undefined;
  payload.type = payload.type?.trim() || undefined;
  payload.project = payload.project?.trim() || undefined;
  payload.cwd = payload.cwd?.trim() || undefined;
  payload.model = payload.model?.trim() || undefined;
  payload.asOf = payload.asOf?.trim() || undefined;

  try {
    const res = await apiFetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    const data = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!res.ok) {
      const detail = data && typeof data === "object" && "error" in data ? String(data.error) : `HTTP ${res.status}`;
      console.error(`ask failed: ${detail}`);
      return 1;
    }

    if (json) {
      console.log(JSON.stringify(data, null, 2));
      return 0;
    }

    if (!data || typeof data !== "object") {
      console.error("ask returned an invalid response");
      return 1;
    }

    printResult(String(data.answer ?? "No answer returned."), data);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
