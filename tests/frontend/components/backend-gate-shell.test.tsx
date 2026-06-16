import { describe, expect, test } from 'bun:test';
import { BackendGate } from '../../../frontend/src/components/BackendGate';
import { htmlFor } from '../_render';

describe('BackendGate shell', () => {
  test('keeps app content hidden while the backend health check is pending', () => {
    const html = htmlFor(
      <BackendGate>
        <p>Loaded dashboard</p>
      </BackendGate>,
    );

    expect(html).toContain('Backend unavailable');
    expect(html).toContain('Checking whether the local Oracle API is ready.');
    expect(html).toContain('Retry');
    expect(html).not.toContain('Loaded dashboard');
    expect(html).not.toContain('Start Backend');
  });
});
