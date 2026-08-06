import { expect, test } from 'bun:test';
import { createEmbeddingProvider } from '../../src/vector/embeddings.ts';
import { trackEnv } from './helpers.ts';

test('embedding provider factory can select Cloudflare AI when credentials are present', () => {
  trackEnv('CLOUDFLARE_ACCOUNT_ID', 'acct');
  trackEnv('CLOUDFLARE_API_TOKEN', 'token');

  expect(createEmbeddingProvider('cloudflare-ai').name).toBe('cloudflare-ai');
});
