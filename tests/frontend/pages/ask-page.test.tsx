import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { AskPage, answerTokens, asOfInputToIso, type AskResponse } from '../../../frontend/src/pages/AskPage';
import { htmlFor } from '../_render';

const response: AskResponse = {
  query: 'What changed in Phoenix indexing?',
  answer: 'Phoenix indexing now uses the current runbook [1]. Legacy steps are superseded [2].',
  citations: [
    { index: 1, id: 'current', title: 'Phoenix current runbook', sourceFile: 'ψ/memory/current.md', excerpt: 'Use sqlite-vec defaults.', confidence: 0.88 },
    { index: 2, id: 'legacy', title: 'Legacy Phoenix runbook', sourceFile: 'ψ/memory/legacy.md', excerpt: 'Old provider prompt.', confidence: 0.42, stale: true },
  ],
  citationIndexes: [1, 2],
  warnings: ['source[2] superseded by current: provider prompt removed', 'source[2] low confidence'],
  noEvidence: false,
  mode: 'rag',
  generatedAt: '2026-07-05T08:00:00.000Z',
  asOf: '2026-07-05T00:00:00.000Z',
  search: { total: 2, limit: 8 },
  sources: [
    { index: 1, id: 'current', title: 'Phoenix current runbook', sourceFile: 'ψ/memory/current.md', excerpt: 'Use sqlite-vec defaults.', confidence: 0.88 },
    { index: 2, id: 'legacy', title: 'Legacy Phoenix runbook', sourceFile: 'ψ/memory/legacy.md', excerpt: 'Old provider prompt.', confidence: 0.42, stale: true, supersededBy: 'current', supersededReason: 'provider prompt removed' },
  ],
};

function pageHtml(initialResponse: AskResponse) {
  return htmlFor(<MemoryRouter><AskPage initialResponse={initialResponse} /></MemoryRouter>);
}

describe('AskPage', () => {
  test('renders cited answers, warning callouts, and source anchors', () => {
    const html = pageHtml(response);
    expect(html).toContain('Ask the Oracle 🔮');
    expect(html).toContain('POST /api/v1/ask');
    expect(html).toContain('Oracle response');
    expect(html).toContain('href="#source-1"');
    expect(html).toContain('href="#source-2"');
    expect(html).toContain('Evidence warnings');
    expect(html).toContain('Stale or superseded evidence');
    expect(html).toContain('Low-confidence evidence');
    expect(html).toContain('id="source-2"');
    expect(html).toContain('Superseded by current: provider prompt removed');
  });

  test('renders an honest no-evidence empty state instead of an answer', () => {
    const html = pageHtml({ ...response, answer: '', citations: [], citationIndexes: [], warnings: ['no_evidence_found'], noEvidence: true, sources: [] });
    expect(html).toContain('No evidence — refusing to guess.');
    expect(html).toContain('No evidence found');
    expect(html).toContain('No sources returned.');
  });


  test('seeds the question field from the shareable q parameter', () => {
    const html = htmlFor(<MemoryRouter initialEntries={['/ask?q=phoenix']}><AskPage /></MemoryRouter>);
    expect(html).toContain('phoenix');
  });

  test('tokenizes citation markers for inline source links', () => {
    expect(answerTokens('Alpha [1] beta [12].')).toEqual([
      { text: 'Alpha ' },
      { text: '[1]', citation: 1 },
      { text: ' beta ' },
      { text: '[12]', citation: 12 },
      { text: '.' },
    ]);
  });

  test('converts optional asOf values from the date picker', () => {
    expect(asOfInputToIso('')).toBeUndefined();
    expect(asOfInputToIso('2026-07-05T12:30')).toBe('2026-07-05T12:30:00.000Z');
  });
});
