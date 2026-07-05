import { describe, expect, test } from 'bun:test';
import {
  IndexFolderCard,
  isLocalOracleHost,
  mineCommandForPath,
} from '../../../frontend/src/components/simple/IndexFolderCard';
import { htmlFor } from '../_render';

const remote = { tauri: false, localApi: false };
const desktop = { tauri: true, localApi: true };

describe('IndexFolderCard', () => {
  test('renders as a collapsed accordion by default', () => {
    const html = htmlFor(<IndexFolderCard runtime={remote} />);

    expect(html).toContain('Add a whole folder of notes');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Folder path');
  });

  test('gates remote browsers to an honest arra mine copy-paste command', () => {
    const html = htmlFor(<IndexFolderCard defaultExpanded initialPath="/home/alex/My Notes" runtime={remote} />);

    expect(html).toContain('Folder path');
    expect(html).toContain('Index folder');
    expect(html).toContain('disabled=""');
    expect(html).toContain('Available in the desktop app or CLI');
    expect(html).toContain("arra mine &#x27;/home/alex/My Notes&#x27;");
    expect(html).toContain('Copy command');
  });

  test('enables direct indexing for the desktop runtime', () => {
    const html = htmlFor(<IndexFolderCard defaultExpanded initialPath="/Users/alex/notes" runtime={desktop} />);

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('Index folder');
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('Desktop/local indexing is available');
    expect(html).not.toContain('CLI fallback');
  });

  test('allows a wired local runner without pretending remote browsers can read folders', () => {
    const html = htmlFor(
      <IndexFolderCard
        defaultExpanded
        initialPath="/vault/notes"
        onIndexFolder={() => 'started'}
        runtime={{ tauri: false, localApi: true }}
      />,
    );

    expect(html).toContain('Index folder');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('CLI fallback');
  });

  test('quotes CLI paths safely and detects local Oracle hosts', () => {
    expect(mineCommandForPath('/tmp/notes')).toBe('arra mine /tmp/notes');
    expect(mineCommandForPath('/tmp/My Notes')).toBe("arra mine '/tmp/My Notes'");
    expect(isLocalOracleHost('localhost:47778')).toBe(true);
    expect(isLocalOracleHost('https://god.buildwithoracle.com')).toBe(false);
  });
});
