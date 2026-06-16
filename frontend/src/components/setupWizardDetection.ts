import type { Stats, VectorConfig } from "./setupWizardTypes";

function docsCount(stats: Stats | null): number {
  return stats?.total_docs ?? stats?.total ?? 0;
}

function vectorCount(stats: Stats | null, config: VectorConfig | null): number {
  const statsCount = stats?.vector?.count;
  if (typeof statsCount === "number") return statsCount;
  return Object.values(config?.doc_counts ?? {}).reduce(
    (sum, count) => sum + count,
    0,
  );
}

function allCollectionsDisabled(config: VectorConfig | null): boolean {
  const collections = Object.values(config?.config?.collections ?? {});
  return (
    collections.length > 0 &&
    collections.every((collection) => collection.enabled === false)
  );
}

export function shouldShowSetupWizard(
  stats: Stats | null,
  config: VectorConfig | null,
): boolean {
  return (
    docsCount(stats) === 0 &&
    (stats?.vector?.enabled === false ||
      vectorCount(stats, config) === 0 ||
      allCollectionsDisabled(config))
  );
}
