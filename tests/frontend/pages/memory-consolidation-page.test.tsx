import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { MemoryConsolidationPage, normalizeSuggestion, type ConsolidationSuggestion } from '../../../frontend/src/pages/MemoryConsolidationPage';
import { htmlFor } from '../_render';

const suggestions: ConsolidationSuggestion[] = [{
  id: 'old-a->new-a',
  original: { id: 'old-a', title: 'Legacy runbook', sourceFile: 'ψ/memory/old.md', content: 'Outdated deployment steps.' },
  suggested: { id: 'new-a', title: 'Current runbook', sourceFile: 'ψ/memory/new.md', content: 'Current deployment steps.' },
  confidence: 0.91,
  reason: 'async consolidation duplicate (cosine=0.96, fts_overlap=0.92)',
}];

function pageHtml(items = suggestions) {
  return htmlFor(<MemoryRouter><MemoryConsolidationPage initialSuggestions={items} /></MemoryRouter>);
}

describe('MemoryConsolidationPage', () => {
  test('renders pending supersede suggestions for human review', () => {
    const html = pageHtml();
    expect(html).toContain('Consolidation review queue');
    expect(html).toContain('Original doc');
    expect(html).toContain('Suggested supersede');
    expect(html).toContain('Legacy runbook');
    expect(html).toContain('Current runbook');
    expect(html).toContain('91% confidence');
    expect(html).toContain('Approve');
    expect(html).toContain('Reject');
  });

  test('renders an empty reviewed state', () => {
    const html = pageHtml([]);
    expect(html).toContain('No pending reviews');
    expect(html).toContain('0%');
  });

  test('normalizes memory-layer plan payloads', () => {
    expect(normalizeSuggestion({
      oldId: 'memory-old',
      newId: 'memory-new',
      cosine: 0.873,
      oldDoc: { title: 'Old note', content: 'stale fact' },
      newDoc: { title: 'New note', content: 'corrected fact' },
    })).toMatchObject({
      id: 'memory-old->memory-new',
      confidence: 0.873,
      original: { id: 'memory-old', title: 'Old note' },
      suggested: { id: 'memory-new', title: 'New note' },
    });
  });
});
