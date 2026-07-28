/**
 * Unit tests for gateway route matcher — glob-to-regex compilation.
 */
import { describe, test, expect } from 'bun:test';
import { compileRoutes, matchRoute } from '../matcher.ts';

const routes = compileRoutes([
  { match: '/api/similar', service: 'vector', fallback: 'fts5' },
  { match: '/api/vector/**', service: 'vector' },
  { match: '/api/map*', service: 'maps' },
  { match: '/api/local', service: 'local' },
]);

describe('gateway matcher', () => {
  test('exact match', () => {
    const m = matchRoute('/api/similar', routes);
    expect(m).not.toBeNull();
    expect(m!.service).toBe('vector');
    expect(m!.fallback).toBe('fts5');
  });

  test('exact match rejects sub-paths', () => {
    expect(matchRoute('/api/similar/extra', routes)).toBeNull();
  });

  test('prefix match with /**', () => {
    expect(matchRoute('/api/vector', routes)?.service).toBe('vector');
    expect(matchRoute('/api/vector/', routes)?.service).toBe('vector');
    expect(matchRoute('/api/vector/stats', routes)?.service).toBe('vector');
    expect(matchRoute('/api/vector/health/deep', routes)?.service).toBe('vector');
  });

  test('prefix match rejects non-matching paths', () => {
    expect(matchRoute('/api/vectorize', routes)).toBeNull();
  });

  test('wildcard match with *', () => {
    expect(matchRoute('/api/map', routes)?.service).toBe('maps');
    expect(matchRoute('/api/mapper', routes)?.service).toBe('maps');
    expect(matchRoute('/api/map-view', routes)?.service).toBe('maps');
  });

  test('no match returns null', () => {
    expect(matchRoute('/api/health', routes)).toBeNull();
    expect(matchRoute('/', routes)).toBeNull();
  });

  test('first match wins', () => {
    const m = matchRoute('/api/similar', routes);
    expect(m!.pattern).toBe('/api/similar');
  });

  test('empty routes returns null', () => {
    expect(matchRoute('/api/anything', compileRoutes([]))).toBeNull();
  });

  test('special regex chars in pattern are escaped', () => {
    const r = compileRoutes([{ match: '/api/v1.0/data', service: 'v1' }]);
    expect(matchRoute('/api/v1.0/data', r)?.service).toBe('v1');
    expect(matchRoute('/api/v1X0/data', r)).toBeNull(); // dot must not match any char
  });
});
