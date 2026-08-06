import { describe, expect, test } from 'bun:test';
import { ErrorMessage, LoadingPanel, Spinner } from '../../../frontend/src/components/AsyncState';
import { EmptyState } from '../../../frontend/src/components/EmptyState';
import { htmlFor } from '../_render';

describe('AsyncState loading and error edges', () => {
  test('Spinner defaults to a Loading status label', () => {
    const html = htmlFor(<Spinner />);
    expect(html).toContain('role="status" aria-label="Loading"');
    expect(html).toContain('Loading');
  });

  test('LoadingPanel omits detail copy when none is supplied', () => {
    const html = htmlFor(<LoadingPanel title="Loading dashboard" />);
    expect(html).toContain('Loading dashboard');
    expect(html).not.toContain('<p class="mt-2');
  });

  test('ErrorMessage and EmptyState render minimal non-action states', () => {
    const errorHtml = htmlFor(<ErrorMessage title="Failed" message="offline" />);
    const emptyHtml = htmlFor(<EmptyState text="Nothing to show." />);
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).not.toContain('<button');
    expect(emptyHtml).toContain('border-dashed');
    expect(emptyHtml).toContain('Nothing to show.');
  });
});
