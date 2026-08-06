import { flag, parseArgs, requestJson, requestText, type ParsedArgs } from './http.ts';

const usage = [
  'usage: maw arra vector-config list|get [collection]',
  '       maw arra vector-config set <collection> <field> <value>',
  '       maw arra vector-config add <collection> --model <model> [--adapter <adapter>]',
  '       maw arra vector-config switch <lancedb|qdrant|chroma|sqlite-vec> [--enabled true|false]',
  '       maw arra vector-config remove|set-primary|test <collection>',
  '       maw arra vector-config reload',
].join('\n');
const adapters = new Set(['chroma', 'sqlite-vec', 'lancedb', 'qdrant', 'cloudflare-vectorize', 'proxy', 'turbovec']);
const switchableAdapters = new Set(['chroma', 'sqlite-vec', 'lancedb', 'qdrant']);
const updateFields = new Set(['adapter', 'model', 'provider', 'service', 'endpoint', 'enabled', 'primary', 'embedder']);
const createFields = new Set([...updateFields, 'collection']);

type JsonObject = Record<string, unknown>;

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function wantsJson(parsed: ParsedArgs): boolean {
  return flag(parsed, 'json') === 'true';
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
    : Object.entries(configCollections(payload)).map(([key, value]) => ({
        key,
        ...object(value),
        count: object(payload.doc_counts)?.[key] ?? 0,
        status: object(object(payload.health)?.[key])?.status ?? 'unknown',
      }));
  return { source: payload.source, collections };
}

function rowText(row: unknown): string {
  const item = object(row) ?? {};
  const key = String(item.collection ?? item.key ?? 'unknown');
  const mark = item.primary === true ? ' ★' : '';
  return [
    `${key}${mark}`,
    String(item.adapter ?? 'lancedb'),
    String(item.model ?? item.key ?? 'unknown'),
    String(item.count ?? item.docs ?? 0),
    String(item.status ?? 'unknown'),
  ].join(' | ');
}

function table(payload: JsonObject): string {
  const listed = listPayload(payload);
  const rows = Array.isArray(listed.collections) ? listed.collections : [];
  const lines = ['Collection | Adapter | Model | Docs | Status'];
  lines.push(...rows.map(rowText));
  if (!rows.length) lines.push('(none) | - | - | 0 | unknown');
  const config = object(payload.config) ?? {};
  const embedder = config.embedder ? `Embedder: ${JSON.stringify(config.embedder)}` : undefined;
  const data = config.dataPath ? `Data: ${String(config.dataPath)}` : undefined;
  return [...lines, '★ = primary', embedder, data].filter(Boolean).join('\n') + '\n';
}

function flagUpdates(parsed: ParsedArgs, fields = updateFields): JsonObject {
  const updates: JsonObject = {};
  for (const field of fields) {
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

async function patchConfig(body: JsonObject): Promise<JsonObject> {
  const text = await requestText('/api/v1/vector/config', {
    method: 'PATCH',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return text ? JSON.parse(text) as JsonObject : {};
}

async function createCollection(collection: string, body: JsonObject): Promise<JsonObject> {
  const text = await requestText(`/api/v1/vector/config/${encodeURIComponent(collection)}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return text ? JSON.parse(text) as JsonObject : {};
}

async function postAction(path: string): Promise<JsonObject> {
  const text = await requestText(path, { method: 'POST', headers: { accept: 'application/json' } });
  return text ? JSON.parse(text) as JsonObject : {};
}

async function removeCollection(collection: string): Promise<JsonObject> {
  const text = await requestText(`/api/v1/vector/config/${encodeURIComponent(collection)}`, {
    method: 'DELETE',
    headers: { accept: 'application/json' },
  });
  return text ? JSON.parse(text) as JsonObject : {};
}

function requiredCollection(parsed: ParsedArgs): string {
  const collection = parsed.positionals[1];
  if (!collection) throw new Error(usage);
  return collection;
}

async function switchBackend(parsed: ParsedArgs): Promise<JsonObject> {
  const adapter = parseValue('adapter', requiredCollection(parsed));
  if (typeof adapter !== 'string' || !switchableAdapters.has(adapter)) {
    throw new Error('switch adapter must be lancedb, qdrant, chroma, or sqlite-vec');
  }
  const enabledRaw = flag(parsed, 'enabled');
  const enabled = enabledRaw === undefined ? undefined : bool(enabledRaw);
  const payload = await readConfig();
  const collections = Object.fromEntries(Object.entries(configCollections(payload)).map(([key, value]) => [
    key,
    { ...object(value), adapter, ...(enabled !== undefined && { enabled }) },
  ]));
  if (Object.keys(collections).length === 0) throw new Error('no vector collections configured');
  return patchConfig({ collections });
}

export async function runVectorConfigCommand(args: string[]): Promise<string> {
  const parsed = parseArgs(args);
  const action = (parsed.positionals[0] ?? 'list').toLowerCase().replace(/-/g, '_');
  if (action === 'list') {
    const payload = await readConfig();
    return wantsJson(parsed) ? json(payload) : table(payload);
  }
  if (action === 'get') {
    const payload = await readConfig();
    const collection = parsed.positionals[1];
    return json(collection ? collectionPayload(payload, collection) : payload);
  }
  if (action === 'set') {
    return json(await writeCollection(requiredCollection(parsed), updateBody(parsed)));
  }
  if (action === 'switch' || action === 'backend') return json(await switchBackend(parsed));
  if (action === 'add') {
    const collection = requiredCollection(parsed);
    const body = flagUpdates(parsed, createFields);
    if (!body.model) throw new Error('add requires --model <model>');
    return json(await createCollection(collection, body));
  }
  if (action === 'remove') {
    if (flag(parsed, 'yes') !== 'true') throw new Error('remove requires --yes');
    return json(await removeCollection(requiredCollection(parsed)));
  }
  if (action === 'set_primary' || action === 'primary') {
    const collection = requiredCollection(parsed);
    return json(await postAction(`/api/v1/vector/config/${encodeURIComponent(collection)}/primary`));
  }
  if (action === 'test') {
    const collection = requiredCollection(parsed);
    return json(await postAction(`/api/v1/vector/config/${encodeURIComponent(collection)}/test`));
  }
  if (action === 'reload') return json(await postAction('/api/v1/vector/config/reload'));
  throw new Error(usage);
}

export const VECTOR_CONFIG_HELP = 'vector-config [--json]|list|get|set|switch|add|remove --yes|set-primary|reload|test';
