import { describe, expect, test } from 'bun:test';
import { ErrorMessage } from '../../../frontend/src/components/AsyncState';
import { htmlFor } from '../_render';

describe('ErrorMessage action', () => {
  test('renders alert text and an optional action node', () => {
    const html = htmlFor(<ErrorMessage title="Failed" message="offline" action={<button type="button">Retry</button>} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Failed');
    expect(html).toContain('offline');
    expect(html).toContain('Retry');
  });
});
