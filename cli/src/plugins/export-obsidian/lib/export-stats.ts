import type { ApiDoc, SimilarResult, VaultStats } from "./types.ts";

export function buildStats(
  docs: ApiDoc[],
  similar: Map<string, SimilarResult[]>,
  slugForId: (id: string) => string,
): VaultStats {
  const byType: Record<string, number> = {};
  const byProject: Record<string, number> = {};
  const conceptCount: Record<string, number> = {};
  for (const d of docs) {
    byType[d.type] = (byType[d.type] ?? 0) + 1;
    if (d.project) byProject[d.project] = (byProject[d.project] ?? 0) + 1;
    for (const c of d.concepts ?? []) conceptCount[c] = (conceptCount[c] ?? 0) + 1;
  }

  const topConcepts = Object.entries(conceptCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 30)
    .map(([name, count]) => ({ name, count }));

  const topLinked = docs
    .map((d) => ({
      slug: slugForId(d.id),
      linkCount: (similar.get(d.id) ?? []).length,
    }))
    .filter((x) => x.linkCount > 0)
    .sort((a, b) => b.linkCount - a.linkCount)
    .slice(0, 20);

  return {
    total: docs.length,
    byType,
    byProject,
    topConcepts,
    topLinked,
    generatedAt: new Date(),
  };
}

export function groupByConcept(docs: ApiDoc[]): Map<string, ApiDoc[]> {
  const out = new Map<string, ApiDoc[]>();
  for (const d of docs) {
    for (const c of d.concepts ?? []) {
      if (!out.has(c)) out.set(c, []);
      out.get(c)!.push(d);
    }
  }
  return out;
}
