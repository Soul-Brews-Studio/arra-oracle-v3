import { describe, expect, test } from 'bun:test';
import { readFirstRunComplete, useFirstRun, FIRST_RUN_COMPLETE_KEY } from '../../../frontend/src/hooks/useFirstRun';
import { htmlFor, installBrowserLocation } from '../_render';

function FirstRunProbe() {
  const firstRun = useFirstRun();
  return <span>{firstRun.setupComplete ? 'complete' : 'pending'}:{firstRun.shouldShowFirstRun ? 'show' : 'hide'}</span>;
}

describe('useFirstRun setup store', () => {
  test('defaults to incomplete without browser storage', () => {
    expect(readFirstRunComplete()).toBe(false);
    expect(htmlFor(<FirstRunProbe />)).toContain('pending:show');
  });

  test('reads truthy setup-complete markers from localStorage', () => {
    const restore = installBrowserLocation('/setup');
    try {
      window.localStorage.setItem(FIRST_RUN_COMPLETE_KEY, 'true');
      expect(readFirstRunComplete()).toBe(true);
      expect(htmlFor(<FirstRunProbe />)).toContain('complete:hide');
    } finally {
      restore();
    }
  });

  test('falls back to incomplete when localStorage throws', () => {
    const previousWindow = globalThis.window;
    globalThis.window = { localStorage: { getItem() { throw new Error('blocked'); } } } as unknown as Window & typeof globalThis;
    try {
      expect(readFirstRunComplete()).toBe(false);
    } finally {
      globalThis.window = previousWindow;
    }
  });
});
