/**
 * Tests for the reranker helper — focus on the graceful-fallback paths.
 * The success path is exercised end-to-end by the empirical bench against
 * the real :8765 sidecar (see arra-mcp-installation-guide-oracle/ψ/lab).
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { rerankCandidates } from '../reranker.ts';

interface Doc { id: string; text: string }
const docs: Doc[] = [
  { id: '1', text: 'hello world' },
  { id: '2', text: 'foo bar baz' },
  { id: '3', text: 'quick brown fox' },
];
const getText = (d: Doc) => d.text;

const ORIGINAL_ENV = process.env.ORACLE_RERANKER_URL;
const ORIGINAL_FETCH = globalThis.fetch;

describe('rerankCandidates', () => {
  beforeEach(() => {
    delete process.env.ORACLE_RERANKER_URL;
    globalThis.fetch = ORIGINAL_FETCH;
  });
  afterEach(() => {
    if (ORIGINAL_ENV) process.env.ORACLE_RERANKER_URL = ORIGINAL_ENV;
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('falls back when no URL is configured', async () => {
    const out = await rerankCandidates({ query: 'q', candidates: docs, getText });
    expect(out.reranked).toBe(false);
    expect(out.fallbackReason).toBe('disabled');
    expect(out.results).toEqual(docs);
  });

  it('returns empty for empty candidate list (no network call)', async () => {
    const out = await rerankCandidates({
      query: 'q', candidates: [] as Doc[], getText, url: 'http://x',
    });
    expect(out.reranked).toBe(false);
    expect(out.results).toEqual([]);
  });

  it('skips network for single candidate', async () => {
    const out = await rerankCandidates({
      query: 'q', candidates: [docs[0]], getText, url: 'http://x',
    });
    expect(out.reranked).toBe(false);
    expect(out.results).toEqual([docs[0]]);
  });

  it('falls back on non-OK HTTP status', async () => {
    globalThis.fetch = mock(async () => new Response('boom', { status: 500 })) as typeof fetch;
    const out = await rerankCandidates({
      query: 'q', candidates: docs, getText, url: 'http://fake',
    });
    expect(out.reranked).toBe(false);
    expect(out.fallbackReason).toBe('http 500');
    expect(out.results).toEqual(docs);
  });

  it('falls back when sidecar returns empty results', async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ results: [], model: 'x' }), { status: 200 })
    ) as typeof fetch;
    const out = await rerankCandidates({
      query: 'q', candidates: docs, getText, url: 'http://fake',
    });
    expect(out.reranked).toBe(false);
    expect(out.fallbackReason).toBe('empty response');
  });

  it('reorders candidates by sidecar score on success', async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          results: [
            { index: 2, score: 0.9, document: 'quick brown fox' },
            { index: 0, score: 0.5, document: 'hello world' },
            { index: 1, score: 0.1, document: 'foo bar baz' },
          ],
          model: 'BAAI/bge-reranker-v2-m3',
        }),
        { status: 200 },
      )
    ) as typeof fetch;
    const out = await rerankCandidates({
      query: 'q', candidates: docs, getText, url: 'http://fake',
    });
    expect(out.reranked).toBe(true);
    expect(out.results.map((d) => d.id)).toEqual(['3', '1', '2']);
  });

  it('honors topK on success', async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          results: [
            { index: 2, score: 0.9, document: 'quick brown fox' },
            { index: 0, score: 0.5, document: 'hello world' },
          ],
          model: 'x',
        }),
        { status: 200 },
      )
    ) as typeof fetch;
    const out = await rerankCandidates({
      query: 'q', candidates: docs, getText, url: 'http://fake', topK: 2,
    });
    expect(out.results).toHaveLength(2);
    expect(out.results.map((d) => d.id)).toEqual(['3', '1']);
  });

  it('falls back on bogus indices (defensive)', async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          results: [{ index: 999, score: 0.9, document: 'wat' }],
          model: 'x',
        }),
        { status: 200 },
      )
    ) as typeof fetch;
    const out = await rerankCandidates({
      query: 'q', candidates: docs, getText, url: 'http://fake',
    });
    expect(out.reranked).toBe(false);
    expect(out.fallbackReason).toBe('no valid indices');
  });

  it('reads URL from process.env.ORACLE_RERANKER_URL', async () => {
    process.env.ORACLE_RERANKER_URL = 'http://from-env';
    globalThis.fetch = mock(async (url: string) => {
      expect(url).toBe('http://from-env/rerank');
      return new Response(
        JSON.stringify({
          results: [{ index: 0, score: 1.0, document: docs[0].text }],
          model: 'x',
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const out = await rerankCandidates({ query: 'q', candidates: docs, getText });
    expect(out.reranked).toBe(true);
  });
});
