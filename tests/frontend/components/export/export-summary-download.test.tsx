import { describe, expect, test } from 'bun:test';
import { DownloadCard } from '../../../../frontend/src/components/export/DownloadCard';
import { ExportSummary } from '../../../../frontend/src/components/export/ExportSummary';
import { htmlFor } from '../../_render';

describe('export summary and download components', () => {
  test('renders an empty export summary with unknown estimates', () => {
    const html = htmlFor(<ExportSummary collections={[]} format="json" />);

    expect(html).toContain('Export summary');
    expect(html).toContain('No collections selected.');
    expect(html).toContain('border-warn-border bg-warn-bg');
    expect(html).toContain('text-warn-text');
    expect(html).toContain('JSON');
    expect(html).toContain('Not estimated');
  });

  test('renders download status only when an export link exists', () => {
    expect(htmlFor(<DownloadCard link={null} />)).toBe('');

    const html = htmlFor(<DownloadCard link={{ url: '/api/export/files/run-1.zip', filename: 'oracle-export.zip' }} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('Export is ready.');
    expect(html).toContain('href="/api/export/files/run-1.zip"');
    expect(html).toContain('download="oracle-export.zip"');
  });
});
