import { afterEach, expect, test } from 'bun:test';
import { configToModels, generateDefaultConfig } from '../../../src/vector/config.ts';

const savedEnv = {
  openai: process.env.OPENAI_API_KEY,
  gemini: process.env.GEMINI_API_KEY,
  google: process.env.GOOGLE_API_KEY,
  cfAccount: process.env.CF_ACCOUNT_ID,
  cfToken: process.env.CF_API_TOKEN,
};

afterEach(() => {
  restore('OPENAI_API_KEY', savedEnv.openai);
  restore('GEMINI_API_KEY', savedEnv.gemini);
  restore('GOOGLE_API_KEY', savedEnv.google);
  restore('CF_ACCOUNT_ID', savedEnv.cfAccount);
  restore('CF_API_TOKEN', savedEnv.cfToken);
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

test('default vector config uses zero-config Ollama with detected remote fallbacks', () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.GOOGLE_API_KEY = 'gemini-test';
  delete process.env.CF_ACCOUNT_ID;
  delete process.env.CF_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;

  const models = configToModels(generateDefaultConfig());

  expect(models['bge-m3'].embedder).toMatchObject({
    backend: 'ollama',
    model: 'bge-m3',
    fallbackChain: ['openai', 'gemini'],
  });
  expect(models.nomic.embedder).toMatchObject({ backend: 'ollama', model: 'nomic-embed-text' });
});

test('explicit provider none remains a disabled power-user override', () => {
  const config = generateDefaultConfig();
  config.embedder = undefined;
  config.collections = {
    ftsOnly: { collection: 'fts_only', model: 'manual', provider: 'none', adapter: 'lancedb' },
  };

  expect(configToModels(config).ftsOnly.embedder).toEqual({ backend: 'none' });
});
