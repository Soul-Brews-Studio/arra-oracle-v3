import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vectorConfigCommand } from '../../../src/cli/commands/vector-config.ts';
import { configPath, generateDefaultConfig, writeVectorConfig } from '../../../src/vector/config.ts';

const savedDataDir = process.env.ORACLE_DATA_DIR;

let root = '';
let dataDir = '';

function seedConfig() {
  const config = generateDefaultConfig();
  config.dataPath = join(root, 'lancedb');
  config.collections = {
    'bge-m3': {
      collection: 'oracle_knowledge_bge_m3',
      model: 'bge-m3',
      provider: 'ollama',
      adapter: 'lancedb',
      primary: true,
    },
    phase2: {
      collection: 'oracle_knowledge_phase2',
      model: 'nomic-embed-text',
      provider: 'remote',
      adapter: 'qdrant',
    },
  };
  writeVectorConfig(config, configPath(dataDir));
}

async function run(args: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await vectorConfigCommand(
    ['vector-config', ...args],
    (message) => { stdout += message; },
    (message) => { stderr += message; },
  );
  return { code, stdout, stderr };
}

function diskConfig() {
  return JSON.parse(readFileSync(configPath(dataDir), 'utf8'));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arra-vector-config-src-'));
  dataDir = join(root, 'data');
  mkdirSync(dataDir);
  process.env.ORACLE_DATA_DIR = dataDir;
  seedConfig();
});

afterEach(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  rmSync(root, { recursive: true, force: true });
});

describe('src vector-config command get/set', () => {
  test('gets a collection by key and collection name', async () => {
    const byKey = await run(['get', 'phase2', '--json']);
    const keyPayload = JSON.parse(byKey.stdout);

    expect(byKey.code).toBe(0);
    expect(byKey.stderr).toBe('');
    expect(keyPayload).toMatchObject({
      source: 'file',
      key: 'phase2',
      config: { model: 'nomic-embed-text', adapter: 'qdrant' },
    });

    const byCollection = await run(['get', 'oracle_knowledge_bge_m3', '--json']);
    expect(JSON.parse(byCollection.stdout).key).toBe('bge-m3');
  });

  test('sets positional and flag-form collection fields on disk', async () => {
    const positional = await run(['set', 'phase2', 'model', 'embed-v2', '--json']);
    expect(positional.code).toBe(0);
    expect(JSON.parse(positional.stdout)).toMatchObject({ success: true, collection: 'phase2' });
    expect(diskConfig().collections.phase2.model).toBe('embed-v2');

    const flags = await run([
      'set',
      'phase2',
      '--adapter',
      'turbovec',
      '--url',
      'http://turbo.test',
      '--enabled',
      'false',
      '--primary',
      'true',
    ]);
    const written = diskConfig();

    expect(flags.code).toBe(0);
    expect(written.collections.phase2).toMatchObject({
      adapter: 'turbovec',
      endpoint: 'http://turbo.test',
      enabled: false,
      primary: true,
    });
    expect(written.collections['bge-m3'].primary).toBe(false);
  });
});
