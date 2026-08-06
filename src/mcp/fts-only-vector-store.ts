import type { VectorQueryResult, VectorStoreAdapter } from '../vector/types.ts';

const emptyResult = (): VectorQueryResult => ({
  ids: [],
  documents: [],
  distances: [],
  metadatas: [],
});

function unavailable(reason: string): Error {
  return new Error(`Vector store unavailable; degraded to FTS5-only (${reason})`);
}

export function createFtsOnlyVectorStore(reason: string): VectorStoreAdapter {
  return {
    name: 'fts5-only',
    async connect() {},
    async close() {},
    async ensureCollection() {},
    async deleteCollection() {},
    async addDocuments() { throw unavailable(reason); },
    async deleteDocuments() {},
    async replaceDocuments() { throw unavailable(reason); },
    async query() { return emptyResult(); },
    async queryById() { return emptyResult(); },
    async queryByVector() { return emptyResult(); },
    async getStats() { return { count: 0 }; },
    async getCollectionInfo() { return { count: 0, name: 'fts5-only' }; },
    async getAllEmbeddings() {
      return { ids: [], embeddings: [], metadatas: [], documents: [] };
    },
  };
}
