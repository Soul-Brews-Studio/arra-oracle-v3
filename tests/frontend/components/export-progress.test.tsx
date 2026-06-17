import { describe, expect, test } from 'bun:test';
import { ExportProgress } from '../../../frontend/src/components/export/ExportProgress';
import type { ExportProgressState } from '../../../frontend/src/hooks/useExport';
import { htmlFor } from '../_render';

const running: ExportProgressState = {
  status: 'running',
  jobId: 'exp-1',
  progress: 42,
  fileSizeEstimate: 1536,
};

describe('ExportProgress', () => {
  test('renders active export progress with a spinner and size estimate', () => {
    const html = htmlFor(<ExportProgress state={running} />);

    expect(html).toContain('Exporting 42%');
    expect(html).toContain('role="status"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('bg-surface');
    expect(html).toContain('bg-surface-muted');
    expect(html).toContain('border-accent-border bg-accent-soft text-accent');
    expect(html).toContain('1.5 KB');
    expect(html).toContain('exp-1');
  });

  test('renders download and retry states', () => {
    const done = htmlFor(<ExportProgress state={{ ...running, status: 'done', progress: 100, downloadUrl: '/download/exp-1', filename: 'export.zip' }} />);
    const failed = htmlFor(<ExportProgress state={{ ...running, status: 'error', error: 'disk full' }} onRetry={() => {}} />);

    expect(done).toContain('Download export');
    expect(done).toContain('href="/download/exp-1"');
    expect(failed).toContain('Export failed.');
    expect(failed).toContain('border-err-border bg-err-bg text-err-text');
    expect(failed).toContain('disk full');
    expect(failed).toContain('Retry');
  });

  test('does not render a dead download link before the URL is ready', () => {
    const html = htmlFor(<ExportProgress state={{ ...running, status: 'done', progress: 100, filename: 'export.zip' }} />);

    expect(html).toContain('Preparing download');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('href=');
    expect(html).toContain('aria-valuetext="Export ready"');
  });
});
