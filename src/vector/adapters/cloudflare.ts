import type { VectorStoreAdapter } from '../types.ts';
import { CloudflareAIEmbeddings, CloudflareVectorizeAdapter } from './cloudflare-vectorize.ts';
import {
  CloudflareVectorizeD1Adapter,
  CloudflareWorkerAIEmbeddings,
  type CloudflareAIWorkerBinding,
  type CloudflareD1Database,
  type CloudflareVectorizeBinding,
} from './cloudflare-worker.ts';

export interface CloudflareVectorStoreOptions {
  embeddingModel?: string;
  cfAccountId?: string;
  cfApiToken?: string;
  cfVectorize?: CloudflareVectorizeBinding;
  cfD1?: CloudflareD1Database;
  cfAi?: CloudflareAIWorkerBinding;
  cfD1Table?: string;
}

export function createCloudflareVectorStore(
  collectionName: string,
  config: CloudflareVectorStoreOptions = {},
): VectorStoreAdapter {
  const model = config.embeddingModel || process.env.ORACLE_EMBEDDING_MODEL;
  if (config.cfVectorize && config.cfD1) {
    const embedder = config.cfAi
      ? new CloudflareWorkerAIEmbeddings(config.cfAi, { model })
      : new CloudflareAIEmbeddings({ ...restConfig(config), model });
    return new CloudflareVectorizeD1Adapter(collectionName, embedder, {
      vectorize: config.cfVectorize,
      d1: config.cfD1,
    }, { tableName: config.cfD1Table });
  }
  const cfConfig = restConfig(config);
  return new CloudflareVectorizeAdapter(
    collectionName,
    new CloudflareAIEmbeddings({ ...cfConfig, model }),
    cfConfig,
  );
}

function restConfig(config: CloudflareVectorStoreOptions) {
  return {
    accountId: clean(config.cfAccountId) || clean(process.env.CF_ACCOUNT_ID) || clean(process.env.CLOUDFLARE_ACCOUNT_ID),
    apiToken: clean(config.cfApiToken) || clean(process.env.CF_API_TOKEN) || clean(process.env.CLOUDFLARE_API_TOKEN),
  };
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export { CloudflareAIEmbeddings, CloudflareVectorizeAdapter } from './cloudflare-vectorize.ts';
export {
  CloudflareVectorizeD1Adapter,
  CloudflareWorkerAIEmbeddings,
  type CloudflareAIWorkerBinding,
  type CloudflareD1Database,
  type CloudflareD1Statement,
  type CloudflareVectorizeBinding,
} from './cloudflare-worker.ts';
