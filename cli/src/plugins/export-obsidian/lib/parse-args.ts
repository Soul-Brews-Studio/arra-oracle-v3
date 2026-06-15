import type { ExportOptions } from "./types.ts";

export function parseArgs(args: string[]): ExportOptions {
  const opts: ExportOptions = {
    out: "",
    model: "bge-m3",
    threshold: 0.75,
    maxLinks: 8,
    types: null,
    project: null,
    dryRun: false,
    incremental: false,
    format: "standard",
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    if (a === "--out") opts.out = next() ?? "";
    else if (a === "--model") opts.model = (next() as ExportOptions["model"]) ?? "bge-m3";
    else if (a === "--threshold") opts.threshold = parseFloat(next() ?? "0.75") || 0.75;
    else if (a === "--max-links") opts.maxLinks = parseInt(next() ?? "8", 10) || 8;
    else if (a === "--types") opts.types = (next() ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--project") opts.project = next() ?? null;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--incremental") opts.incremental = true;
    else if (a === "--format") opts.format = (next() as ExportOptions["format"]) ?? "standard";
  }

  if (!opts.out) {
    throw new Error("Usage: arra-cli export-obsidian --out <path> [flags]");
  }
  if (opts.threshold < 0 || opts.threshold > 1) {
    throw new Error("--threshold must be between 0.0 and 1.0");
  }
  return opts;
}
