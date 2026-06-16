import { closeCachedVectorStores } from '../../vector/factory.ts';
import type { VectorDBType } from '../../vector/types.ts';
import {
  activeConfig,
  atomicWriteVectorConfig,
  inspectCollection,
  resolveCollection,
} from '../../routes/vector/config-api-utils.ts';

const ADAPTERS = new Set(['lancedb', 'qdrant', 'chroma', 'sqlite-vec', 'cloudflare-vectorize', 'proxy']);
type Field = 'adapter' | 'enabled' | 'model' | 'provider';
type Writer = (message: string) => void;

function usage(out: Writer): void {
  out([
    'usage: bun run src/cli/index.ts vector-config [--json]',
    '       bun run src/cli/index.ts vector-config set <collection> adapter <lancedb|qdrant|chroma|sqlite-vec>',
    '       bun run src/cli/index.ts vector-config set <collection> enabled <true|false>',
    '       bun run src/cli/index.ts vector-config test <collection>',
    '       bun run src/cli/index.ts vector-config reload',
  ].join('\n') + '\n');
}

function flag(args: string[], name: string): boolean {
  return args.includes(name);
}

function parseValue(field: Field, value: string): string | boolean {
  if (field === 'enabled') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error('enabled must be true or false');
  }
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} must be non-empty`);
  if (field === 'adapter' && !ADAPTERS.has(trimmed)) throw new Error(`adapter must be one of ${[...ADAPTERS].join(', ')}`);
  return trimmed;
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

async function setField(args: string[], out: Writer): Promise<number> {
  const [, collection, rawField, rawValue] = args;
  if (!collection || !rawField || rawValue === undefined) throw new Error('set requires <collection> <field> <value>');
  const field = rawField as Field;
  if (!['adapter', 'enabled', 'model', 'provider'].includes(field)) throw new Error('field must be adapter, enabled, model, or provider');
  const { config } = activeConfig();
  const resolved = resolveCollection(config, collection);
  if (!resolved) throw new Error(`unknown vector collection: ${collection}`);
  const [key, current] = resolved;
  const next = { ...config, collections: { ...config.collections, [key]: { ...current, [field]: parseValue(field, rawValue) } } };
  const path = atomicWriteVectorConfig(next);
  await closeCachedVectorStores();
  out(`updated ${key}: ${field}=${rawValue}\npath: ${path}\n`);
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
    if (command === 'set') return setField(rest.filter((item) => !item.startsWith('--')), stdout);
    if (command === 'test') return testCollection(rest.filter((item) => !item.startsWith('--')), stdout);
    if (command === 'reload') { await closeCachedVectorStores(); stdout('vector config runtime cache reloaded\n'); return 0; }
    throw new Error(`unknown vector-config command: ${command}`);
  } catch (error) {
    stderr((error instanceof Error ? error.message : String(error)) + '\n');
    usage(stderr);
    return 1;
  }
}
