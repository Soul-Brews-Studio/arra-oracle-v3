import { expect, test } from 'bun:test';
import {
  clearEmbedderRuntimeStatusForTests,
  formatEmbedderDegradedWarning,
  probeConfiguredEmbedder,
} from '../../src/vector/embedder-config.ts';
import { clearVectorEnv } from './helpers.ts';

test('boot probe reports unset auto embedder as degraded FTS5-only without network', async () => {
  clearVectorEnv();
  clearEmbedderRuntimeStatusForTests();

  const status = await probeConfiguredEmbedder(undefined, { timeoutMs: 10 });

  expect(status).toMatchObject({
    status: 'degraded',
    provider: 'ollama',
    source: 'auto-default',
    explicit: false,
    reason: 'no embedder configured/reachable — FTS5-only',
  });
  expect(formatEmbedderDegradedWarning(status.provider, status.reason!))
    .toBe('[Oracle] embedder ollama unreachable (no embedder configured/reachable — FTS5-only) → degraded to FTS5-only');
});

test('boot probe turns missing OpenAI credentials into degraded status', async () => {
  clearVectorEnv();
  clearEmbedderRuntimeStatusForTests();
  process.env.ORACLE_EMBEDDER = 'openai';

  const status = await probeConfiguredEmbedder(undefined, { timeoutMs: 10 });

  expect(status.status).toBe('degraded');
  expect(status.provider).toBe('openai');
  expect(status.reason).toContain('FTS5-only');
  expect(status.reason).toContain('OPENAI_API_KEY');
});
