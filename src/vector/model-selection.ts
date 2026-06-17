export const VECTOR_MULTI_MODEL_ORDER = ['bge-m3', 'nomic', 'qwen3'] as const;

export function selectVectorSearchModelKeys(
  model: string | undefined,
  models: Record<string, unknown>,
): Array<string | undefined> {
  if (model !== 'multi') return [model && hasModel(models, model) ? model : undefined];

  const preferred = VECTOR_MULTI_MODEL_ORDER.filter((key) => hasModel(models, key));
  const seen = new Set<string>(preferred);
  const extras = Object.keys(models).filter((key) => !seen.has(key));
  const selected = [...preferred, ...extras];
  return selected.length > 0 ? selected : [undefined];
}

function hasModel(models: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(models, key);
}
