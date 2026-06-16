import { describe, expect, test } from 'bun:test';
import { ExportHelp } from '../../../../frontend/src/components/export/ExportHelp';
import { htmlFor } from '../../_render';

describe('ExportHelp', () => {
  test('documents recovery and retry steps for migration-safe exports', () => {
    const html = htmlFor(<ExportHelp backendUrl="http://oracle.local:47778" />);

    expect(html).toContain('Recovery &amp; retry');
    expect(html).toContain('Run Test connection first');
    expect(html).toContain('use Retry before changing settings');
    expect(html).toContain('manifest.json');
    expect(html).toContain('export ORACLE_API=http://oracle.local:47778');
  });
});
