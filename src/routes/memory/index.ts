import { Elysia } from 'elysia';
import { RecallMemoryQuery, SaveMemoryBody } from './model.ts';
import { memoryStore, type InMemoryStore, type MemoryInput } from './store.ts';

export function createMemoryRoutes(store: InMemoryStore = memoryStore) {
  return new Elysia({ prefix: '/api' })
    .post('/memory/save', ({ body, set }) => {
      try {
        const memory = store.save(body as MemoryInput);
        return { success: true, memory };
      } catch (error) {
        set.status = 400;
        return { success: false, error: error instanceof Error ? error.message : 'failed to save memory' };
      }
    }, {
      body: SaveMemoryBody,
      detail: { tags: ['memory'], menu: { group: 'hidden' }, summary: 'Save an in-memory note' },
    })
    .get('/memory/recall', ({ query }) => {
      const limit = Math.min(50, Math.max(1, parseInt(query.limit ?? '10')));
      const items = store.recall(query.q ?? '', limit);
      return { query: query.q ?? '', total: items.length, items };
    }, {
      query: RecallMemoryQuery,
      detail: { tags: ['memory'], menu: { group: 'hidden' }, summary: 'Recall in-memory notes' },
    });
}

export const memoryRoutes = createMemoryRoutes();
