import { expect, test } from 'bun:test';
import { createVectorStore } from '../../src/vector/factory.ts';
import { trackEnv } from './helpers.ts';

test('vector store factory can build Cloudflare Vectorize with colocated AI embeddings', () => {
  trackEnv('CLOUDFLARE_ACCOUNT_ID', 'acct');
  trackEnv('CLOUDFLARE_API_TOKEN', 'token');

  const store = createVectorStore({ type: 'cloudflare-vectorize', collectionName: 'cf_index' });

  expect(store.name).toBe('cloudflare-vectorize');
});
