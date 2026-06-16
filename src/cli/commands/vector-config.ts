import { closeCachedVectorStores } from '../../vector/factory.ts';
import type { VectorDBType } from '../../vector/types.ts';
import {
  activeConfig,
  atomicWriteVectorConfig,
  inspectCollection,
  resolveCollection,
  withPrimary,
} from '../../routes/vector/config-api-utils.ts';

const ADAPTERS = new Set(['lancedb', 'qdrant', 'chroma', 'sqlite-vec', 'cloudflare-vectorize', 'proxy', 'turbovec']);
const FIELDS = new Set(['adapter', 'collection', 'embedder', 'enabled', 'endpoint', 'model', 'primary', 'provider', 'service']);
type Field = 'adapter' | 'collection' | 'embedder' | 'enabled' | 'endpoint' | 'model' | 'primary' | 'provider' | 'service';
type Writer = (message: string) => void;
type Update = Partial<Record<Field, unknown>>;

function usage(out: Writer): void {
  out([
    'usage: bun run src/cli/index.ts vector-config [list] [--json]',
    '       bun run src/cli/index.ts vector-config get [collection] [--json]',
    '       bun run src/cli/index.ts vector-config set <collection> <field> <value> [--json]',
    '       bun run src/cli/index.ts vector-config set <collection> --adapter <name> [--url <url>]',
    '       bun run src/cli/index.ts vector-config switch <adapter> [--enabled true|false]',
    '       bun run src/cli/index.ts vector-config test <collection>',
    '       bun run src/cli/index.ts vector-config reload',
  ].join('\n') + '\n');
}

function flag(args: string[], name: string): boolean {
  return args.includes(name);
}

function fieldName(raw: string): Field {
  const field = raw.replace(/^--/, '').replace(/^url$/, 'endpoint') as Field;
  if (!FIELDS.has(field)) throw new Error(`field must be one of ${[...FIELDS].join(', ')}`);
  return field;
}

function parseValue(field: Field, value: string): unknown {
  if (field === 'enabled' || field === 'primary') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`${field} must be true or false`);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} must be non-empty`);
  if (field === 'embedder') return JSON.parse(trimmed) as unknown;
  if (field === 'adapter') {
    const normalized = trimmed === 'cloudflare' ? 'cloudflare-vectorize' : trimmed;
    if (!ADAPTERS.has(normalized)) throw new Error(`adapter must be one of ${[...ADAPTERS].join(', ')}`);
    return normalized;
  }
  return trimmed;
}

function cleanArgs(args: string[]): string[] {
  return args.filter((item) => !['--json', '--help', '-h'].includes(item));
}

function parseUpdates(args: string[]): Update {
  const updates: Update = {};
  const [field, value] = args;
  if (field && !field.startsWith('--')) {
    if (value === undefined) throw new Error('set field value required');
    updates[fieldName(field)] = parseValue(fieldName(field), value);
    args = args.slice(2);
  }
  for (let i = 0; i < args.length; i += 2) {
    const rawField = args[i];
    const rawValue = args[i + 1];
    if (!rawField?.startsWith('--')) throw new Error('set requires <field> <value> pairs or --field <value>');
    if (rawValue === undefined || rawValue.startsWith('--')) throw new Error(`${rawField} value required`);
    const parsedField = fieldName(rawField);
    updates[parsedField] = parseValue(parsedField, rawValue);
  }
  if (!Object.keys(updates).length) throw new Error('set requires at least one field');
  return updates;
}

async function readState(json: boolean, out: Writer): Promise<number> {
  const { source, config } = activeConfig();
  const rows = await Promise.all(Object.entries(config.collections).map(async ([key, col]) => inspectCollection(key, col, config)));
  const payload = { source, config, collections: rows, checked_at: new Date().toISOString() };
  if (json) out(JSON.stringify(payload, null, 2) + '\n');
  else {
    out(`source: ${source}\n`);
    out('Collection | Adapter | Model | Enabled | Docs | Status\n');
    for (const row of rows) out(`${row.key} | ${row.adapter} | ${row.model} | ${row.enabled} | ${row.count} | ${row.status}${row.error ? ` (${row.error})` : ''}\n`);
  }
  return 0;
}

function onePayload(collection: string) {
  const { source, config } = activeConfig();
  const resolved = resolveCollection(config, collection);
  if (!resolved) throw new Error(`unknown vector collection: ${collection}`);
  const [key, current] = resolved;
  return { source, config, key, current };
}

async function getCollection(args: string[], jsonOut: boolean, out: Writer): Promise<number> {
  const collection = args[1];
  if (!collection) {
    const { source, config } = activeConfig();
    out(JSON.stringify({ source, config }, null, 2) + '\n');
    return 0;
  }
  const { source, key, current } = onePayload(collection);
  const payload = { source, key, config: current };
  if (jsonOut) out(JSON.stringify(payload, null, 2) + '\n');
  else out(Object.entries(payload.config).map(([name, value]) => `${name}: ${JSON.stringify(value)}`).join('\n') + `\nkey: ${key}\nsource: ${source}\n`);
  return 0;
}

async function switchBackend(args: string[], jsonOut: boolean, out: Writer): Promise<number> {
  const requested = args[1];
  if (!requested) throw new Error('switch requires <adapter>');
  const adapter = parseValue('adapter', requested) as VectorDBType;
  if (!['lancedb', 'qdrant', 'chroma', 'sqlite-vec'].includes(adapter)) {
    throw new Error('switch adapter must be lancedb, qdrant, chroma, or sqlite-vec');
  }
  const enabledIndex = args.indexOf('--enabled');
  const enabledValue = args[enabledIndex + 1];
  if (enabledIndex >= 0 && (!enabledValue || enabledValue.startsWith('--'))) throw new Error('--enabled value required');
  const enabled = enabledIndex >= 0 ? parseValue('enabled', enabledValue) as boolean : undefined;
  const { source, config } = activeConfig();
  const collections = Object.fromEntries(Object.entries(config.collections).map(([key, current]) => [
    key,
    { ...current, adapter, ...(enabled !== undefined && { enabled }) },
  ]));
  const next: typeof config = { ...config, collections };
  const path = atomicWriteVectorConfig(next);
  await closeCachedVectorStores();
  if (jsonOut) out(JSON.stringify({ success: true, source, path, adapter, config: next }, null, 2) + '\n');
  else out(`switched vector backend adapter to ${adapter} across ${Object.keys(collections).length} collections\npath: ${path}\n`);
  return 0;
}

async function setField(args: string[], jsonOut: boolean, out: Writer): Promise<number> {
  const [, collection, ...rawUpdates] = args;
  if (!collection) throw new Error('set requires <collection>');
  const updates = parseUpdates(rawUpdates);
  const { source, config, key, current } = onePayload(collection);
  const nextBase: typeof config = { ...config, collections: { ...config.collections, [key]: { ...current, ...(updates as Partial<typeof current>) } } };
  const next = updates.primary === true ? withPrimary(nextBase, key) : nextBase;
  const path = atomicWriteVectorConfig(next);
  await closeCachedVectorStores();
  if (jsonOut) out(JSON.stringify({ success: true, source, path, collection: key, config: next }, null, 2) + '\n');
  else out(`updated ${key}: ${Object.entries(updates).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join(', ')}\npath: ${path}\n`);
  return 0;
}

async function testCollection(args: string[], out: Writer): Promise<number> {
  const collection = args[1];
  if (!collection) throw new Error('test requires <collection>');
  const { config } = activeConfig();
  const resolved = resolveCollection(config, collection);
  if (!resolved) throw new Error(`unknown vector collection: ${collection}`);
  const [key, col] = resolved;
  const health = await inspectCollection(key, col, config);
  out(JSON.stringify(health, null, 2) + '\n');
  return health.ok ? 0 : 1;
}

export async function vectorConfigCommand(args: string[], stdout: Writer = process.stdout.write.bind(process.stdout), stderr: Writer = process.stderr.write.bind(process.stderr)): Promise<number> {
  try {
    const rest = args.slice(1);
    if (flag(rest, '--help') || flag(rest, '-h')) { usage(stdout); return 0; }
    const command = rest.find((item) => !item.startsWith('--'));
    if (!command) return readState(flag(rest, '--json'), stdout);
    if (command === 'list') return readState(flag(rest, '--json'), stdout);
    if (command === 'get') return getCollection(cleanArgs(rest), flag(rest, '--json'), stdout);
    if (command === 'set') return setField(cleanArgs(rest), flag(rest, '--json'), stdout);
    if (command === 'switch' || command === 'backend') return switchBackend(cleanArgs(rest), flag(rest, '--json'), stdout);
    if (command === 'test') return testCollection(cleanArgs(rest), stdout);
    if (command === 'reload') { await closeCachedVectorStores(); stdout('vector config runtime cache reloaded\n'); return 0; }
    throw new Error(`unknown vector-config command: ${command}`);
  } catch (error) {
    stderr((error instanceof Error ? error.message : String(error)) + '\n');
    usage(stderr);
    return 1;
  }
}
