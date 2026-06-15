import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../../frontend/src/components/AppShell';
import { htmlFor } from '../_render';

describe('AppShell error banner', () => {
  test('renders backend loading errors with a retry action', () => {
    const html = htmlFor(
      <MemoryRouter>
        <AppShell error="backend offline" loading={false} menuCount={0} pluginCount={0} surfaceCount={0} updatedAt="never" onRefresh={() => {}}>
          <p />
        </AppShell>
      </MemoryRouter>,
    );
    expect(html).toContain('Could not load backend data.');
    expect(html).toContain('backend offline');
    expect(html).toContain('Retry');
  });
});
