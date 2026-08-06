/**
 * The routes must match the contract strings the frontend declares (#2879, acceptance criterion 1).
 *
 * `frontend/src/pages/fleetLogMock.ts` is the source of truth here: it declared
 * `FLEET_SEARCH_CONTRACT` and `FLEET_THREAD_CONTRACT` while the page rendered fixtures, and the
 * page told users so, visibly. That was the correct handling of a mocked surface — the value
 * only survives if the contract and the routes cannot drift apart afterwards.
 *
 * This guard is deliberately mechanical. It compares the declared path and parameter names
 * against the implementation, so renaming a query parameter on either side fails here rather
 * than becoming a filter that silently never matches.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const MOCK = readFileSync(join(ROOT, 'frontend/src/pages/fleetLogMock.ts'), 'utf-8');
const SEARCH = readFileSync(join(ROOT, 'src/routes/fleet-log/search.ts'), 'utf-8');
const THREAD = readFileSync(join(ROOT, 'src/routes/fleet-log/thread.ts'), 'utf-8');
const FILTERS = readFileSync(join(ROOT, 'src/routes/fleet-log/filters.ts'), 'utf-8');

function declaredContract(name: string): string {
  const match = MOCK.match(new RegExp(`${name} = '([^']+)'`));
  if (!match) throw new Error(`${name} not found in fleetLogMock.ts`);
  return match[1]!;
}

describe('the declared contracts still exist in the frontend', () => {
  test('both contract constants are present', () => {
    expect(declaredContract('FLEET_SEARCH_CONTRACT')).toContain('/api/fleet-log/search');
    expect(declaredContract('FLEET_THREAD_CONTRACT')).toContain('/api/fleet-log/thread/:key');
  });
});

describe('the routes implement those exact paths', () => {
  test('search is registered at the declared path', () => {
    // The cluster mounts with prefix '/api', so the route declares the remainder.
    expect(SEARCH).toContain("'/fleet-log/search'");
  });

  test('thread is registered at the declared path, with :key', () => {
    expect(THREAD).toContain("'/fleet-log/thread/:key'");
  });
});

describe('every declared query parameter is actually read', () => {
  const params = declaredContract('FLEET_SEARCH_CONTRACT')
    .split('?')[1]!
    .split('&')
    .map((pair) => pair.split('=')[0]!)
    .filter(Boolean);

  test('the contract declares the six documented parameters', () => {
    expect(params).toEqual(['query', 'channel', 'from', 'to', 'since', 'until']);
  });

  for (const param of ['query', 'channel', 'from', 'to', 'since', 'until']) {
    test(`"${param}" is accepted by the route and used by the filter builder`, () => {
      // Accepted in the Elysia query schema...
      expect(SEARCH).toContain(`${param}: t.Optional(t.String())`);
      // ...and actually consumed, not merely declared. A parameter that is parsed and then
      // dropped is the #2877 shape: real-looking code that changes nothing.
      expect(FILTERS).toContain(`query.${param}`);
    });
  }
});

describe('the channel list matches the frontend', () => {
  test('FLEET_CHANNELS is identical on both sides', () => {
    const extract = (src: string) => {
      const raw = src.match(/FLEET_CHANNELS = \[([^\]]+)\]/)![1]!;
      return raw.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    };
    // A channel accepted by one side and rejected by the other is a 400 the user cannot explain.
    expect(extract(FILTERS)).toEqual(extract(MOCK));
  });
});
