import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import {
  ErrorBoundary,
  ErrorBoundaryFallback,
  reportErrorToMetrics,
} from '../../frontend/src/components/ErrorBoundary';
import { htmlFor } from './_render';

describe('ErrorBoundary fallback', () => {
  test('renders fallback UI with auto-retry and reporting status', () => {
    const html = htmlFor(createElement(ErrorBoundaryFallback, {
      error: new Error('Widget exploded'),
      componentStack: 'at Widget',
      retryCount: 2,
      reportStatus: 'reported',
      onRetry: () => {},
    }));

    expect(html).toContain('Frontend error boundary');
    expect(html).toContain('The dashboard hit a rendering error.');
    expect(html).toContain('Widget exploded');
    expect(html).toContain('Report status: reported');
    expect(html).toContain('Auto-retry attempts: 2');
    expect(html).toContain('aria-label="Auto-retry rendering after error"');
    expect(html).toContain('at Widget');
  });

  test('normalizes thrown values into boundary state errors', () => {
    const state = ErrorBoundary.getDerivedStateFromError('string failure');
    expect(state.error).toBeInstanceOf(Error);
    expect(state.error?.message).toBe('string failure');
    expect(state.reportStatus).toBe('idle');
  });
});

describe('reportErrorToMetrics', () => {
  test('posts frontend error reports to /api/metrics', async () => {
    let request: { input: RequestInfo | URL; init?: RequestInit } | null = null;
    const ok = await reportErrorToMetrics(
      new Error('render failed'),
      { componentStack: 'at Dashboard' },
      1,
      async (input, init) => {
        request = { input, init };
        return new Response(JSON.stringify({ ok: true }), { status: 202 });
      },
    );

    expect(ok).toBe(true);
    expect(String(request?.input)).toBe('/api/metrics');
    expect(request?.init?.method).toBe('POST');
    const headers = new Headers(request?.init?.headers);
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-arra-report')).toBe('frontend-error-boundary');
    const body = JSON.parse(String(request?.init?.body));
    expect(body).toMatchObject({
      source: 'frontend-error-boundary',
      name: 'Error',
      message: 'render failed',
      componentStack: 'at Dashboard',
      retryCount: 1,
    });
  });

  test('returns false when metrics reporting is unavailable', async () => {
    const ok = await reportErrorToMetrics(new Error('offline'), { componentStack: '' }, 0, async () => {
      throw new Error('network down');
    });

    expect(ok).toBe(false);
  });
});
