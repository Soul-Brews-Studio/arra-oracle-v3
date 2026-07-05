import { getEmbeddingModels } from '../../vector/factory.ts';

type ParsedModel = { ok: true; value?: string } | { ok: false; error: string };

export function parseOptionalSearchModel(
  value: unknown,
  models = getEmbeddingModels(),
): ParsedModel {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== 'string') return { ok: false, error: 'model must be a string' };
  const model = value.trim();
  if (!model) return { ok: false, error: 'model must not be blank' };
  if (model === 'multi' || models[model]) return { ok: true, value: model };
  return { ok: false, error: `Unknown model: ${model}` };
}
