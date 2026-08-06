import { describe, expect, test } from 'bun:test';
import { defaultDataPathForEngine, generateDefaultConfig } from '../../../src/vector/config.ts';
import { resolveEmbeddingProvider, resolveVectorBackend } from '../../../src/vector/backend-resolution.ts';

describe('P0 first-run config defaults', () => {
  test('selects local vector and embedding defaults without prompting', () => {
    const defaults = generateDefaultConfig();
    const backend = resolveVectorBackend(defaults, 'defaults', {} as NodeJS.ProcessEnv);
    const provider = resolveEmbeddingProvider(defaults, 'defaults', []);

    expect(defaults.enabled).toBe(false);
    expect(defaults.collections['bge-m3']).toMatchObject({ adapter: 'sqlite-vec', provider: 'ollama', primary: true });
    expect(backend).toMatchObject({
      engine: 'sqlite-vec',
      source: 'first-run-default',
      dataPath: defaultDataPathForEngine('sqlite-vec'),
      localDefault: true,
      returningUser: false,
      providerPrompt: false,
      wizard: 'optional',
    });
    expect(provider).toMatchObject({
      provider: 'ollama',
      source: 'first-run-default',
      local: true,
      returningUser: false,
      providerPrompt: false,
      wizard: 'optional',
    });
  });
});
