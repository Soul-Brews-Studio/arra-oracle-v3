/**
 * ORA-SHARED-20260821-11 — ties docs/RUNBOOK.md's :8081 /health claim to
 * real runtime behavior in one place, so the two cannot silently drift again
 * (the exact miss window 10 left behind: the health route's behavior changed,
 * the RUNBOOK text describing it did not, in the same candidate).
 *
 * Black-box, component-level evidence: asserts the observable HTTP response
 * (status code + JSON body) from the real createVectorProxyServer app driven
 * with an injected store (real or failing), not internal implementation
 * (readyStore/state are never touched directly). This is NOT a same-interface
 * / end-to-end proof against the live deployed sidecar process — it proves
 * the production route-handler code behaves as documented when given each
 * store outcome, not that the live process has been observed producing both.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createVectorProxyServer } from '../../src/vector/proxy-server.ts';
import type { VectorDocument, VectorQueryResult, VectorStoreAdapter } from '../../src/vector/adapter.ts';

const runbook = readFileSync('docs/RUNBOOK.md', 'utf8');

class FakeStore implements VectorStoreAdapter {
  readonly name = 'contract-fake';
  connect: () => Promise<void>;

  constructor(connectBehavior: () => Promise<void> = async () => {}) {
    this.connect = connectBehavior;
  }

  async close() {}
  async ensureCollection() {}
  async deleteCollection() {}
  async addDocuments(_docs: VectorDocument[]) {}
  async query(): Promise<VectorQueryResult> {
    return { ids: [], documents: [], distances: [], metadatas: [] };
  }
  async queryById(): Promise<VectorQueryResult> {
    return { ids: [], documents: [], distances: [], metadatas: [] };
  }
  async getStats() { return { count: 0 }; }
  async getCollectionInfo() { return { count: 0, name: 'contract_test' }; }
}

function request(path: string) {
  return new Request(`http://vector.local${path}`);
}

describe('RUNBOOK.md :8081 /health claim matches real runtime behavior', () => {
  test('the stale pre-ORA-SHARED-10 wording is not present', () => {
    // The exact phrase this pass retired — a fresh restart no longer shows
    // ready:false "until something touches the store" as a non-fault.
    expect(runbook).not.toMatch(/ready:false.{0,40}until something touches the store/i);
    expect(runbook).not.toMatch(/set BEFORE the first actual `\/vectors\/\*` operation runs/);
  });

  test('the current expectation (200 ready:true / 503 degraded) is documented', () => {
    expect(runbook).toMatch(/HTTP 200.*"ready":true/);
    expect(runbook).toMatch(/HTTP 503.*"ready":false/);
  });

  test('the caveat that this proves store init, not search results, is documented', () => {
    expect(runbook).toMatch(/not\*\* that the vector index is[\s\S]{0,20}fresh/i);
    expect(runbook).toMatch(/not\*\* that[\s\S]{0,40}`\/api\/search`/i);
  });

  test('REAL behavior: a healthy store answers 200 with ready:true on the first health probe', async () => {
    const app = createVectorProxyServer({ store: new FakeStore() });
    const response = await app.handle(request('/health'));
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: 'ok', ready: true });
  });

  test('REAL behavior: a store that fails to connect answers 503 with ready:false', async () => {
    const failing = new FakeStore(async () => { throw new Error('lancedb unreachable'); });
    const app = createVectorProxyServer({ store: failing });
    const response = await app.handle(request('/health'));
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ status: 'degraded', ready: false });
  });
});
