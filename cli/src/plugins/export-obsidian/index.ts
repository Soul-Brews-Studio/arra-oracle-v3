// arra-cli export-obsidian --out <path> [flags]
// Issue #933 — CLI: export ARRA → Obsidian vault.
//
// Pipeline:
//   - fetchAllDocs (threader) → ApiDoc[]
//   - fetchSimilar per doc (threader) → similarity edges
//   - renderDocMarkdown per doc (scribe) → body .md
//   - renderIndex + renderConceptHub (scribe) → _index.md + _concepts/*.md
//   - writeVault (weaver) → atomic write with incremental hash skip

import type { InvokeContext, InvokeResult } from "../../plugin/types.ts";
import type {
  ApiDoc,
  ExportOptions,
  SimilarResult,
  VaultFile,
} from "./lib/types.ts";
import { slugify, slugifyPath, shortIdHash } from "./lib/slugify.ts";
import { writeVault, writeStateFile } from "./lib/vault-writer.ts";
import { fetchAllDocs } from "./lib/fetch-docs.ts";
import { fetchSimilar } from "./lib/fetch-similar.ts";
import { renderDocMarkdown, deriveTitle } from "./lib/render-body.ts";
import { renderIndex } from "./lib/render-index.ts";
import { renderConceptHub } from "./lib/concept-hub.ts";
import { hashPayload } from "./lib/state-hash.ts";
import { buildStats, groupByConcept } from "./lib/export-stats.ts";
import { parseArgs } from "./lib/parse-args.ts";

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  let opts: ExportOptions;
  try {
    opts = parseArgs(ctx.args);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  console.error(`[fetch] listing docs (types=${opts.types?.join(",") ?? "all"}, project=${opts.project ?? "*"})...`);
  const docs: ApiDoc[] = await fetchAllDocs({
    types: opts.types ?? undefined,
    project: opts.project ?? undefined,
  });
  console.error(`[fetch] ${docs.length} docs`);

  // Build id → slug map. On collision, append short hash of id so distinct
  // docs don't clobber each other. Track path uniqueness, not slug — two
  // folders may share the same slug (e.g. learnings/foo.md + retros/foo.md).
  const slugById = new Map<string, string>();
  const usedPaths = new Set<string>();
  let slugCollisions = 0;
  for (const doc of docs) {
    const base = slugifyPath(doc.type, doc.id, doc.title ?? doc.id).replace(/\.md$/, "");
    let slug = base;
    if (usedPaths.has(slug)) {
      slugCollisions++;
      const suffix = shortIdHash(doc.id);
      slug = `${base}-${suffix}`;
      // Very defensive: if even the suffixed slug collides, keep extending.
      let n = 2;
      while (usedPaths.has(slug)) {
        slug = `${base}-${suffix}-${n++}`;
      }
    }
    usedPaths.add(slug);
    slugById.set(doc.id, slug);
  }
  if (slugCollisions > 0) {
    console.error(`[slug] ${slugCollisions} collisions resolved via id-hash suffix`);
  }
  const slugForId = (id: string) => slugById.get(id) ?? id;

  // Similarity edges. Failure on one doc shouldn't abort the whole export.
  const similarByDoc = new Map<string, SimilarResult[]>();
  let similarErrors = 0;
  const progressEvery = Math.max(1, Math.floor(docs.length / 50));
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    try {
      const edges = await fetchSimilar(doc.id, {
        model: opts.model,
        threshold: opts.threshold,
        limit: opts.maxLinks,
      });
      similarByDoc.set(doc.id, edges);
    } catch (err) {
      similarErrors++;
      similarByDoc.set(doc.id, []);
      if (similarErrors <= 3) {
        console.error(`[skip similar] ${doc.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if ((i + 1) % progressEvery === 0 || i + 1 === docs.length) {
      const pct = Math.round(((i + 1) / docs.length) * 100);
      console.error(`[similar] ${i + 1}/${docs.length} (${pct}%) — errors=${similarErrors}`);
    }
  }

  const files: VaultFile[] = [];

  // Per-doc bodies. Skip docs with null/undefined content defensively.
  let renderSkipped = 0;
  for (const doc of docs) {
    const relPath = `${slugForId(doc.id)}.md`;
    try {
      const safeDoc = { ...doc, content: doc.content ?? "", concepts: doc.concepts ?? [] };
      const content = renderDocMarkdown(safeDoc, {
        similar: similarByDoc.get(doc.id) ?? [],
        slugForId,
        model: opts.model,
        threshold: opts.threshold,
      });
      files.push({ relPath, content });
    } catch (err) {
      renderSkipped++;
      if (renderSkipped <= 3) {
        console.error(`[skip render] ${doc.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // _index.md
  const stats = buildStats(docs, similarByDoc, slugForId);
  files.push({ relPath: "_index.md", content: renderIndex(stats) });

  // Per-concept hubs (top concepts only).
  const docsByConcept = groupByConcept(docs);
  for (const { name } of stats.topConcepts) {
    const related = docsByConcept.get(name) ?? [];
    if (related.length === 0) continue;
    files.push({
      relPath: `_concepts/${slugify(name)}.md`,
      content: renderConceptHub(name, related, slugForId),
    });
  }

  const report = await writeVault(opts.out, files, {
    dryRun: opts.dryRun,
    incremental: opts.incremental,
  });

  // Issue #938 — write .arra-vault-state.json so import-obsidian can diff.
  if (!opts.dryRun && report.errors.length === 0) {
    const stateDocs: Record<string, { relPath: string; contentHash: string }> = {};
    for (const doc of docs) {
      const relPath = `${slugForId(doc.id)}.md`;
      const title = deriveTitle(doc);
      const hash = hashPayload(title, doc.content, doc.concepts ?? []);
      stateDocs[doc.id] = { relPath, contentHash: hash };
    }
    await writeStateFile(opts.out, {
      version: 1,
      last_export: new Date().toISOString(),
      model: opts.model,
      threshold: opts.threshold,
      docs: stateDocs,
    });
  }

  const lines: string[] = [];
  lines.push(`Obsidian vault export → ${opts.out}`);
  lines.push(`  docs:       ${docs.length}`);
  lines.push(`  files:      ${files.length}`);
  lines.push(`  written:    ${report.written}`);
  lines.push(`  unchanged:  ${report.unchanged}`);
  lines.push(`  skipped:    ${report.skipped} (dry-run)`);
  if (report.errors.length > 0) {
    lines.push(`  errors:     ${report.errors.length}`);
    for (const e of report.errors.slice(0, 5)) lines.push(`    - ${e.relPath}: ${e.message}`);
  }

  const ok = report.errors.length === 0;
  return ok ? { ok, output: lines.join("\n") } : { ok, error: lines.join("\n") };
}

export { parseArgs } from "./lib/parse-args.ts";
