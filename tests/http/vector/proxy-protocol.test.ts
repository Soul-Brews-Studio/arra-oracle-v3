import { expect, test } from 'bun:test';
import {
  VECTOR_PROXY_PROTOCOL_VERSION,
  VECTOR_PROXY_ROUTES,
  buildVectorProxyUrl,
  isHealthyVectorProxy,
} from '../../../src/vector/proxy-protocol.ts';

test('vector proxy protocol exports the #1438 HTTP contract', () => {
  expect(VECTOR_PROXY_PROTOCOL_VERSION).toBe('vector-proxy-v1');
  expect(VECTOR_PROXY_ROUTES).toEqual({
    add: '/vectors/add',
    query: '/vectors/query',
    stats: '/vectors/stats',
    collection: '/vectors/collection',
    health: '/health',
  });
});

test('vector proxy protocol helpers preserve endpoint path prefixes', () => {
  expect(buildVectorProxyUrl('http://127.0.0.1:8082/base/', '/health')).toBe(
    'http://127.0.0.1:8082/base/health',
  );
  expect(isHealthyVectorProxy({ status: 'ok' })).toBe(true);
  expect(isHealthyVectorProxy({ status: 'degraded' })).toBe(false);
});
