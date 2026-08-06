import { describe, expect, test } from 'bun:test';
import { FIRST_RUN_COMPLETE_KEY, readFirstRunComplete, useFirstRun } from '../../../frontend/src/hooks/useFirstRun';
import { htmlFor, installBrowserLocation } from '../_render';

function FirstRunContextProbe() {
  const firstRun = useFirstRun();
  return <span>{firstRun.setupComplete ? 'complete' : 'pending'}:{firstRun.shouldShowFirstRun ? 'show' : 'hide'}</span>;
}

function withWindow(value: unknown) {
  const previousWindow = globalThis.window;
  globalThis.window = value as Window & typeof globalThis;
  return () => { globalThis.window = previousWindow; };
}

describe('first-run setup store edge cases', () => {
  test('treats only documented truthy localStorage markers as complete', () => {
    const restore = installBrowserLocation('/vector/first-run');
    try {
      window.localStorage.setItem(FIRST_RUN_COMPLETE_KEY, '1');
      expect(readFirstRunComplete()).toBe(true);
      window.localStorage.setItem(FIRST_RUN_COMPLETE_KEY, 'TRUE');
      expect(readFirstRunComplete()).toBe(false);
      window.localStorage.setItem(FIRST_RUN_COMPLETE_KEY, '0');
      expect(readFirstRunComplete()).toBe(false);
    } finally {
      restore();
    }
  });

  test('renders the setup context from persisted local state during SSR', () => {
    const restore = installBrowserLocation('/vector/first-run');
    try {
      window.localStorage.setItem(FIRST_RUN_COMPLETE_KEY, '1');
      expect(htmlFor(<FirstRunContextProbe />)).toContain('complete:hide');
    } finally {
      restore();
    }
  });

  test('falls back to incomplete when the browser context lacks localStorage', () => {
    const restore = withWindow({});
    try {
      expect(readFirstRunComplete()).toBe(false);
      expect(htmlFor(<FirstRunContextProbe />)).toContain('pending:show');
    } finally {
      restore();
    }
  });
});
