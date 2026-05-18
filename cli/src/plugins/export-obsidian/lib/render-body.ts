// Per-doc markdown body renderer.
// Output: frontmatter + # Title + original content + Related + Concepts.
// Pure — no I/O. Deterministic for a given input.

import type { ApiDoc, SimilarResult, DocMeta } from "./types.ts";
import { renderFrontmatter } from "./render-frontmatter.ts";

export interface RenderDocOpts {
  similar: SimilarResult[];
  slugForId: (id: string) => string;
  model: string;
  threshold: number;
}

// Title = first H1 in content, else source_file basename (minus ext),
// else first 80 chars of content. Always a single line, trimmed.
export function deriveTitle(doc: ApiDoc): string {
  const h1 = doc.content.match(/^#\s+(.+?)\s*$/m);
  if (h1 && h1[1].trim()) return h1[1].trim();
  if (doc.source_file) {
    const base = doc.source_file.split("/").pop() ?? doc.source_file;
    const stripped = base.replace(/\.(md|markdown|txt)$/i, "");
    if (stripped.trim()) return stripped.trim();
  }
  const snippet = doc.content.trim().replace(/\s+/g, " ").slice(0, 80);
  return snippet || "(untitled)";
}

// Strip a leading H1 from content if present so we don't double-render it.
function stripLeadingH1(content: string): string {
  return content.replace(/^\s*#\s+.+?\s*(?:\r?\n|$)/, "").replace(/^\s+/, "");
}

function renderRelated(
  docId: string,
  similar: SimilarResult[],
  slugForId: (id: string) => string,
  threshold: number,
): string {
  const rows = similar
    .filter((s) => s.id !== docId && s.score >= threshold)
    .map((s) => `- [[${slugForId(s.id)}]] (${s.score.toFixed(2)})`);
  if (rows.length === 0) return "";
  return ["## Related (by embedding)", ...rows].join("\n");
}

function renderConcepts(concepts: string[]): string {
  if (concepts.length === 0) return "";
  const tags = concepts.map((c) => `#${c}`).join(" ");
  return ["## Concepts", tags].join("\n");
}

export function renderDocMarkdown(
  doc: ApiDoc,
  opts: RenderDocOpts,
): string {
  const meta: DocMeta = {
    arra_id: doc.id,
    arra_type: doc.type,
    arra_project: doc.project,
    arra_created: doc.created_at,
    muninn_concepts: doc.concepts,
    arra_model: opts.model,
    arra_similarity_threshold: opts.threshold,
  };

  const title = deriveTitle(doc);
  const body = stripLeadingH1(doc.content).trimEnd();
  const related = renderRelated(doc.id, opts.similar, opts.slugForId, opts.threshold);
  const concepts = renderConcepts(doc.concepts);

  const parts: string[] = [];
  parts.push(renderFrontmatter(meta).trimEnd());
  parts.push("");
  parts.push(`# ${title}`);
  parts.push("");
  if (body) {
    parts.push(body);
    parts.push("");
  }
  if (related) {
    parts.push(related);
    parts.push("");
  }
  if (concepts) {
    parts.push(concepts);
    parts.push("");
  }
  return parts.join("\n");
}
