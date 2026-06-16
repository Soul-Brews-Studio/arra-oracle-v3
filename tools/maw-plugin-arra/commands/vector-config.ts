import { flag, parseArgs, requestJson, requestText, type ParsedArgs } from './http.ts';

const usage = 'usage: maw arra vector-config list|get [collection]|set <collection> <field> <value>';
const adapters = new Set(['chroma', 'sqlite-vec', 'lancedb', 'qdrant', 'cloudflare-vectorize', 'proxy']);
const updateFields = new Set(['adapter', 'model', 'provider', 'service', 'endpoint', 'enabled', 'primary', 'embedder', 'collection']);

type JsonObject = Record<string, unknown>;

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

function bool(value: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('boolean values must be true or false');
}

function parseValue(field: string, value: string): unknown {
  if (field === 'enabled' || field === 'primary') return bool(value);
  if (field === 'embedder') return JSON.parse(value) as unknown;
  if (field === 'adapter') {
    const normalized = value === 'cloudflare' ? 'cloudflare-vectorize' : value;
    if (!adapters.has(normalized)) throw new Error('unsupported vector adapter');
    return normalized;
  }
  return value;
}

function configCollections(payload: JsonObject): JsonObject {
  return object(object(payload.config)?.collections) ?? {};
}

function collectionPayload(payload: JsonObject, collection: string): JsonObject {
  const configured = object(configCollections(payload)[collection]);
  const listed = Array.isArray(payload.collections)
    ? payload.collections.find((row) => object(row)?.key === collection || object(row)?.collection === collection)
    : undefined;
  const row = object(listed);
  if (!configured && !row) throw new Error(`unknown vector collection: ${collection}`);
  return { key: collection, ...configured, ...row };
}

function listPayload(payload: JsonObject): JsonObject {
  const collections = Array.isArray(payload.collections)
    ? payload.collections
    : Object.entries(configCollections(payload)).map(([key, value]) => ({ key, ...object(value) }));
  return { source: payload.source, collections };
}

function flagUpdates(parsed: ParsedArgs): JsonObject {
  const updates: JsonObject = {};
  for (const field of updateFields) {
    const raw = flag(parsed, field === 'endpoint' ? 'url' : field) ?? flag(parsed, field);
    if (raw !== undefined) updates[field] = parseValue(field, raw);
  }
  return updates;
}

function updateBody(parsed: ParsedArgs): JsonObject {
  const [, , field, value] = parsed.positionals;
  const updates = flagUpdates(parsed);
  if (field !== undefined) {
    if (value === undefined) throw new Error('set field value required');
    if (!updateFields.has(field)) throw new Error(`unsupported vector config field: ${field}`);
    updates[field] = parseValue(field, value);
  }
  if (Object.keys(updates).length === 0) throw new Error(usage);
  return updates;
}

async function readConfig(): Promise<JsonObject> {
  return await requestJson<JsonObject>('/api/v1/vector/config');
}

async function writeCollection(collection: string, body: JsonObject): Promise<JsonObject> {
  const text = await requestText(`/api/v1/vector/config/${encodeURIComponent(collection)}`, {
    method: 'PUT',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return text ? JSON.parse(text) as JsonObject : {};
}

export async function runVectorConfigCommand(args: string[]): Promise<string> {
  const parsed = parseArgs(args);
  const action = (parsed.positionals[0] ?? 'list').toLowerCase().replace(/-/g, '_');
  if (action === 'list') return json(listPayload(await readConfig()));
  if (action === 'get') {
    const payload = await readConfig();
    const collection = parsed.positionals[1];
    return json(collection ? collectionPayload(payload, collection) : payload);
  }
  if (action === 'set') {
    const collection = parsed.positionals[1];
    if (!collection) throw new Error(usage);
    return json(await writeCollection(collection, updateBody(parsed)));
  }
  throw new Error(usage);
}

export const VECTOR_CONFIG_HELP = 'vector-config list|get [collection]|set <collection> <field> <value>';
