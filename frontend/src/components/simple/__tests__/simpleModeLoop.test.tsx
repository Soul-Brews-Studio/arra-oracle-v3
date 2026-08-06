import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { HealthHero } from '../../HealthHero.tsx';
import { SimplePage } from '../../../pages/SimplePage.tsx';
import {
  AddMemory,
  AddMemoryFeedback,
  saveSimpleMemory,
  simpleMemoryPayload,
  type SimpleMemoryPayload,
} from '../AddMemory.tsx';
import {
  IndexFolderCard,
  isLocalOracleHost,
  mineCommandForPath,
} from '../IndexFolderCard.tsx';
import { SimpleSearch, SIMPLE_SEARCH_EMPTY, simpleSearchStatus, visibleSimpleResults } from '../SimpleSearch.tsx';
import { HealthState, mapHealthState } from '../healthState.ts';

function result(id: number) {
  return { id: String(id), content: `memory ${id}`, source_file: `note-${id}.md` };
}

describe('Simple Mode core loop contracts', () => {
  test('search contract exposes input, button, examples, cap, and empty copy', () => {
    const html = renderToStaticMarkup(<SimpleSearch />);
    expect(html).toContain('Simple search form');
    expect(html).toContain('Search memory…');
    expect(html).toContain('deployment notes');
    expect(visibleSimpleResults([1, 2, 3, 4, 5, 6].map(result))).toHaveLength(5);
    expect(simpleSearchStatus('ready', 'missing', 0)).toBe(SIMPLE_SEARCH_EMPTY);
    expect(simpleSearchStatus('error', 'vector', 0)).toContain('retry');
  });

  test('add memory posts trimmed Simple Mode payload and rejects blanks', async () => {
    let sent: SimpleMemoryPayload | null = null;
    const payload = await saveSimpleMemory('  remember this  ', async (next) => {
      sent = next;
    });
    expect(payload).toEqual({ pattern: 'remember this', source: 'Simple Mode' });
    expect(sent).toEqual(payload);
    expect(simpleMemoryPayload('  note  ')).toEqual({ pattern: 'note', source: 'Simple Mode' });
    await expect(saveSimpleMemory('   ', async () => {
      throw new Error('should not call backend');
    })).rejects.toThrow('Memory text is required.');
  });

  test('add memory UI keeps retryable error and aria-live saved confirmation', () => {
    const form = renderToStaticMarkup(<AddMemory />);
    expect(form).toContain('Save something to memory');
    const saved = renderToStaticMarkup(<AddMemoryFeedback status="saved" error="" fading={false} saving={false} onRetry={() => {}} />);
    expect(saved).toContain('aria-live="polite"');
    expect(saved).toContain('Saved.');
    const error = renderToStaticMarkup(<AddMemoryFeedback status="error" error="offline" fading={false} saving={false} onRetry={() => {}} />);
    expect(error).toContain('Couldn’t save memory.');
    expect(error).toContain('Retry');
  });

  test('index folder browser fallback is explicit and copy-paste safe', () => {
    expect(isLocalOracleHost('localhost:47778')).toBe(true);
    expect(isLocalOracleHost('v4.buildwithoracle.com')).toBe(false);
    expect(mineCommandForPath('/Users/alex/My Notes')).toBe("arra mine '/Users/alex/My Notes'");
    expect(mineCommandForPath('')).toBe('arra mine <dir>');
    const fallback = renderToStaticMarkup(
      <IndexFolderCard defaultExpanded initialPath="/tmp/notes" runtime={{ tauri: false, localApi: true }} />,
    );
    expect(fallback).toContain('Browser tabs cannot launch local folder reads directly');
    expect(fallback).toContain('arra mine /tmp/notes');
    expect(fallback).toContain('Copy command');
  });

  test('simple path keeps actions visible while observing degraded search health', async () => {
    const page = renderToStaticMarkup(<SimplePage />);
    const state = mapHealthState({
      msSinceLoad: 10_000,
      health: { status: 'ok', dbStatus: 'connected', pluginStatus: 'ok', vectorAvailable: false },
    });
    expect(state).toBe(HealthState.DegradedFts);
    const hero = renderToStaticMarkup(<HealthHero state={state} checkedAt={Date.now()} onAction={() => {}} />);
    const search = visibleSimpleResults([1, 2].map(result));
    let saved: SimpleMemoryPayload | null = null;
    await saveSimpleMemory('degraded search still saves', async (payload) => {
      saved = payload;
    });
    expect(page).toContain('Ask your Oracle');
    expect(page).toContain('Add a memory');
    expect(page).toContain('Add a whole folder of notes');
    expect(hero).toContain('Running, but search is limited');
    expect(search).toHaveLength(2);
    expect(saved).toEqual({ pattern: 'degraded search still saves', source: 'Simple Mode' });
  });
});
