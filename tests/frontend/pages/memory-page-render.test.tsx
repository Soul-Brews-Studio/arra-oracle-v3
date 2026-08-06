import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { MemoryPage, memoryHealthStatus } from '../../../frontend/src/pages/MemoryPage';
import { htmlFor } from '../_render';

describe('MemoryPage', () => {
  test('renders memory health route chrome and query controls', () => {
    const html = htmlFor(
      <MemoryRouter initialEntries={['/memory?q=oracle']}>
        <MemoryPage />
      </MemoryRouter>,
    );

    expect(html).toContain('Memory health');
    expect(html).toContain('class="glass rounded-3xl');
    expect(html).toContain('Heat and recency');
    expect(html).toContain('Heat heatmap');
    expect(html).toContain('Confidence bars');
    expect(html).toContain('Valid-time timeline');
    expect(html).toContain('Supersede-chain viewer');
    expect(html).toContain('aria-label="Memory health search form"');
    expect(html).toContain('value="oracle"');
    expect(html).toContain('Run a search to inspect memory health signals.');
  });

  test('summarizes health states', () => {
    expect(memoryHealthStatus('idle', '', 0)).toContain('Search memory');
    expect(memoryHealthStatus('loading', 'oracle', 0)).toContain('Building memory health view');
    expect(memoryHealthStatus('ready', 'oracle', 2)).toContain('2 memory results');
    expect(memoryHealthStatus('error', 'oracle', 0)).toBe('Memory health search failed.');
  });
});
