// YAML frontmatter builder for a single exported doc.
// Pure — no I/O, no fetch, no fs. Deterministic output.

import type { DocMeta } from "./types.ts";

// YAML-safe scalar: quote if it contains characters that need escaping.
// Keeps the output readable when quoting isn't needed.
function scalar(v: string): string {
  if (v === "") return '""';
  // Always quote if value contains chars that break YAML parsers.
  const risky = /[:#&*!|>'"%@`{}\[\],\n]|^\s|\s$|^[-?]|^(true|false|null|yes|no|on|off)$/i;
  if (!risky.test(v)) return v;
  // Double-quoted: escape backslash and double-quote.
  const escaped = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function yamlArray(items: string[]): string {
  if (items.length === 0) return "[]";
  return `[${items.map(scalar).join(", ")}]`;
}

export function renderFrontmatter(meta: DocMeta): string {
  const tagSet = new Set<string>();
  if (meta.arra_type) tagSet.add(meta.arra_type);
  for (const c of meta.muninn_concepts) tagSet.add(c);
  const tags = Array.from(tagSet);

  const lines: string[] = ["---"];
  lines.push(`arra_id: ${scalar(meta.arra_id)}`);
  lines.push(`arra_type: ${scalar(meta.arra_type)}`);
  if (meta.arra_project !== undefined) {
    lines.push(`arra_project: ${scalar(meta.arra_project)}`);
  }
  if (meta.arra_created !== undefined) {
    lines.push(`arra_created: ${scalar(meta.arra_created)}`);
  }
  lines.push(`muninn_concepts: ${yamlArray(meta.muninn_concepts)}`);
  lines.push(`arra_model: ${scalar(meta.arra_model)}`);
  lines.push(`arra_similarity_threshold: ${meta.arra_similarity_threshold}`);
  lines.push(`tags: ${yamlArray(tags)}`);
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}
