import { describe, expect, test } from 'bun:test';
import { ErrorBoundaryFallback, reportErrorToMetrics } from '../../../frontend/src/components/ErrorBoundary';
import { htmlFor, installBrowserLocation } from '../_render';

describe('ErrorBoundary edge states', () => {
  test('falls back to an unknown message and omits an empty component stack', () => {
    const html = htmlFor(<ErrorBoundaryFallback
      error={new Error('')}
      componentStack=""
      retryCount={0}
      reportStatus="failed"
      onRetry={() => {}}
    />);

    expect(html).toContain('Unknown rendering error');
    expect(html).toContain('Report status: failed');
    expect(html).toContain('Auto-retry attempts: 0');
    expect(html).not.toContain('<pre');
  });

  test('returns false for non-ok report responses while preserving browser URL context', async () => {
    const restore = installBrowserLocation('/vector?tab=health');
    let body: Record<string, unknown> = {};
    try {
      const ok = await reportErrorToMetrics(new Error('render failed'), { componentStack: 'at VectorPage' }, 3, async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ ok: false }), { status: 503 });
      });

      expect(ok).toBe(false);
      expect(body).toMatchObject({
        source: 'frontend-error-boundary',
        message: 'render failed',
        componentStack: 'at VectorPage',
        retryCount: 3,
        url: 'http://localhost/vector?tab=health',
      });
      expect(typeof body.timestamp).toBe('string');
    } finally {
      restore();
    }
  });

  test('returns false when no metrics fetcher is available', async () => {
    await expect(reportErrorToMetrics(new Error('offline'), { componentStack: '' }, 0, undefined)).resolves.toBe(false);
  });
});
