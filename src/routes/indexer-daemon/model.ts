export const jobStatuses = ['pending', 'claimed', 'done', 'error'] as const;
export type JobStatus = typeof jobStatuses[number];

export type ModelRegistry = Record<string, { collection: string }>;

export type ParsedJobsQuery = {
  status?: JobStatus;
  modelKey?: string;
  limit: number;
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function trimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseRequiredString(value: unknown, label: string): ParseResult<string> {
  const trimmed = trimmedString(value);
  return trimmed ? { ok: true, value: trimmed } : { ok: false, error: `${label} required` };
}

export function parseOptionalModelKey(value: unknown, models: ModelRegistry): ParseResult<string | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  const modelKey = trimmedString(value);
  if (!modelKey) return { ok: false, error: 'model_key must not be blank' };
  if (!models[modelKey]) return { ok: false, error: `Unknown model_key: ${modelKey}` };
  return { ok: true, value: modelKey };
}

export function parseJobsQuery(query: { status?: string; model?: string; limit?: string }, models: ModelRegistry): ParseResult<ParsedJobsQuery> {
  const status = parseOptionalStatus(query.status);
  if (status.ok === false) return status;
  const model = parseOptionalModelFilter(query.model, models);
  if (model.ok === false) return model;
  const limit = parseLimit(query.limit);
  if (limit.ok === false) return limit;
  return { ok: true, value: { status: status.value, modelKey: model.value, limit: limit.value } };
}

function parseOptionalStatus(value: unknown): ParseResult<JobStatus | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  const status = trimmedString(value);
  if (!status) return { ok: false, error: 'status must not be blank' };
  if (!jobStatuses.includes(status as JobStatus)) return { ok: false, error: 'Invalid status (pending|claimed|done|error)' };
  return { ok: true, value: status as JobStatus };
}

function parseOptionalModelFilter(value: unknown, models: ModelRegistry): ParseResult<string | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  const modelKey = trimmedString(value);
  if (!modelKey) return { ok: false, error: 'model must not be blank' };
  if (!models[modelKey]) return { ok: false, error: `Unknown model: ${modelKey}` };
  return { ok: true, value: modelKey };
}

function parseLimit(value: unknown): ParseResult<number> {
  if (value === undefined || value === null || value === '') return { ok: true, value: 100 };
  if (typeof value !== 'string') return { ok: false, error: 'limit must be an integer between 1 and 1000' };
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return { ok: false, error: 'limit must be an integer between 1 and 1000' };
  const limit = Number(trimmed);
  if (!Number.isSafeInteger(limit) || limit < 1) return { ok: false, error: 'limit must be an integer between 1 and 1000' };
  return { ok: true, value: Math.min(limit, 1000) };
}
