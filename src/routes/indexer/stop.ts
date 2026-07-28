import { Elysia } from 'elysia';
import { setAbortFlag } from './start.ts';

export const stopEndpoint = new Elysia().post('/indexer/stop', () => {
  setAbortFlag(true);
  return { stopped: true };
}, {
  detail: {
    tags: ['indexer'],
    summary: 'Stop running indexer job',
  },
});
