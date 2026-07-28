import { Elysia } from 'elysia';
import { getEmbeddingModels } from '../../vector/factory.ts';

export const configEndpoint = new Elysia().get('/indexer/config', async () => {
  const models = getEmbeddingModels();

  const modelList = Object.entries(models).map(([key, m]) => ({
    key,
    model: m.model,
    collection: m.collection,
    dims: key === 'nomic' ? 768 : key === 'bge-m3' ? 1024 : 4096,
    speed: key === 'nomic' ? '~100 doc/s' : key === 'bge-m3' ? '~50 doc/s' : '~30 doc/s',
  }));

  const adapters = ['lancedb', 'sqlite-vec', 'chroma', 'qdrant', 'cloudflare-vectorize'];
  const currentAdapter = process.env.ORACLE_VECTOR_DB || 'lancedb';

  let ollamaModels: string[] = [];
  try {
    const res = await fetch('http://localhost:11434/api/tags');
    if (res.ok) {
      const data = await res.json() as { models?: Array<{ name: string }> };
      ollamaModels = (data.models || []).map(m => m.name);
    }
  } catch {}

  return { adapters, models: modelList, ollamaModels, currentAdapter };
}, {
  detail: {
    tags: ['indexer'],
    menu: { group: 'tools', order: 110 },
    summary: 'Indexer configuration — adapters, models, Ollama status',
  },
});
