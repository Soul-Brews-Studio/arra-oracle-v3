import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

type ApiWrap<T> = T | { success: boolean; data: T };

test.describe('real-data /api/ask + entity search verification', () => {
  test.skip(process.env.REAL_DATA_VERIFY !== '1', 'Set REAL_DATA_VERIFY=1 to run against the local 35k-doc corpus.');

  test('answers from indexed docs and probes entity sidecar', async ({ request, page }) => {
    const stats = unwrap(await json<{ total: number; database: string }>(await request.get('/api/stats')));
    expect(stats.total).toBeGreaterThanOrEqual(35_000);

    const ask = unwrap(await json<any>(await request.post('/api/v1/ask', {
      data: { q: 'oracle memory', llm: false, limit: 3 },
    })));
    expect(ask.noEvidence).toBe(false);
    expect(ask.citations.length).toBeGreaterThan(0);
    expect(ask.sources.length).toBeGreaterThan(0);
    expect(ask.search.total).toBeGreaterThan(1_000);

    const entity = unwrap(await json<any>(await request.get('/api/v1/vector/entities/search?q=oracle&limit=5')));
    expect(entity.mode).toBe('entity-vector');
    expect(String(entity.collection).endsWith('_entities')).toBe(true);
    expect(Array.isArray(entity.results)).toBe(true);

    mkdirSync('docs/verification', { recursive: true });
    await page.setContent(reportHtml({ stats, ask, entity }));
    await page.screenshot({ path: 'docs/verification/ask-entity-real-data.png', fullPage: true });
  });
});

async function json<T>(response: { ok: () => boolean; status: () => number; json: () => Promise<T>; text: () => Promise<string> }): Promise<T> {
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

function unwrap<T>(body: ApiWrap<T>): T {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}

function reportHtml(input: { stats: any; ask: any; entity: any }): string {
  const entityStatus = input.entity.results.length ? 'entity hits returned' : 'entity sidecar empty';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:32px;}
    main{max-width:980px;margin:auto;}section{border:1px solid #334155;border-radius:18px;padding:20px;margin:18px 0;background:#111827;}
    h1,h2{color:#fff}.ok{color:#5eead4}.warn{color:#fbbf24}pre{white-space:pre-wrap;background:#020617;padding:14px;border-radius:12px;color:#cbd5e1;}
  </style></head><body><main>
    <h1>Arra Oracle real-data verification</h1>
    <section><h2>Corpus</h2><p class="ok">${input.stats.total.toLocaleString()} docs loaded</p><p>${escape(input.stats.database)}</p></section>
    <section><h2>/api/ask</h2><p class="ok">${input.ask.sources.length} sources, ${input.ask.citations.length} citations, total ${input.ask.search.total}</p><pre>${escape(input.ask.answer)}</pre></section>
    <section><h2>/api/vector/entities/search</h2><p class="${input.entity.results.length ? 'ok' : 'warn'}">${entityStatus}: ${input.entity.results.length} hits in ${escape(input.entity.collection)}</p><pre>${escape(JSON.stringify(input.entity.results.slice(0, 3), null, 2))}</pre></section>
  </main></body></html>`;
}

function escape(value: unknown): string {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]!));
}
