/**
 * The Memory dashboard must let a reader tell *empty* from *broken* (#2859).
 *
 * Nat compared this page's "1 active KB memories" against the Studio overview's 35,179
 * documents and concluded something was broken. Nothing was: `/api/v1/memory/recall` reads
 * `oracle_memories` (1 row) while the overview counts `oracle_documents` (35,179). Two
 * unrelated tables, and the memory tier is written by hand — it is **manual by decision**
 * (Nat, 2026-07-25), so an empty one is the normal state, not a fault.
 *
 * The old copy said "No memories matched this dashboard filter", which is actively wrong when
 * no filter was applied, and the label said "KB" — which reads as *the knowledge base*.
 */
import { describe, expect, test } from 'bun:test';
import { MemoryDashboardContent } from '../../frontend/src/pages/MemoryDashboardPage';
import { htmlFor } from './_render';

const empty = (filtered: boolean) =>
  htmlFor(<MemoryDashboardContent items={[]} total={0} state="ready" filtered={filtered} />);

describe('empty memory tier reads as empty, not broken', () => {
  const html = empty(false);

  test('says plainly that it is empty rather than broken', () => {
    expect(html).toContain('empty, not broken');
  });

  test('explains that memories are hand-written, so a reader knows nothing is missing', () => {
    expect(html).toContain('written by hand');
    expect(html).toContain('/api/v1/memory');
  });

  test('states that this is NOT the document corpus — the exact confusion that prompted it', () => {
    expect(html).toContain('not the document corpus');
  });

  test('says a large document count and an empty tier are both normal at once', () => {
    expect(html).toContain('are both normal at the same time');
  });

  test('does not claim a filter excluded anything when none was applied', () => {
    expect(html).not.toContain('matched this filter');
  });
});

describe('a filtered empty result still reads as a filtered result', () => {
  const html = empty(true);

  test('names the filter as the reason', () => {
    expect(html).toContain('No memories matched this filter');
  });

  test('does not tell the user the tier is empty when it may not be', () => {
    expect(html).not.toContain('empty, not broken');
    expect(html).not.toContain('not the document corpus');
  });
});

describe('nothing on the page calls this tier the KB', () => {
  // "KB" reads as the knowledge base — the 35,179 indexed documents — which this page has
  // never shown. That single word is what made the two screens look contradictory.
  for (const [label, html] of [
    ['empty', empty(false)],
    ['filtered', empty(true)],
  ] as const) {
    test(`${label} state avoids "KB"`, () => {
      expect(html).not.toContain('KB memories');
      expect(html).not.toContain('KB provenance');
    });
  }

  test('the summary card names the tier instead', () => {
    expect(empty(false)).toContain('hand-written memory tier');
  });

  test('the page blurb says the counts do not track the corpus', () => {
    expect(empty(false)).toContain('do not track it');
  });
});
