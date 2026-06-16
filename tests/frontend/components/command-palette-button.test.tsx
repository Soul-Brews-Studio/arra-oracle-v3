import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { CommandPalette } from '../../../frontend/src/components/CommandPalette';
import { htmlFor } from '../_render';

describe('CommandPalette', () => {
  test('renders a button that opens the command modal', () => {
    const html = htmlFor(
      <MemoryRouter>
        <CommandPalette onRefresh={() => {}} />
      </MemoryRouter>,
    );
    expect(html).toContain('Open command palette');
    expect(html).toContain('Search actions (⌘K)');
  });
});
