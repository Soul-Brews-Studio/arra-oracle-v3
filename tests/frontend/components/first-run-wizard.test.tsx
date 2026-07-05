import { describe, expect, test } from 'bun:test';
import { FirstRunWizard } from '../../../frontend/src/components/wizard/FirstRunWizard';
import { FIRST_RUN_COMPLETE_KEY, useFirstRun } from '../../../frontend/src/hooks/useFirstRun';
import { htmlFor, installBrowserLocation } from '../_render';

function FirstRunProbe() {
  const { setupComplete, shouldShowFirstRun } = useFirstRun();
  return <span>{setupComplete ? 'complete' : 'pending'}:{shouldShowFirstRun ? 'show' : 'hide'}</span>;
}

describe('FirstRunWizard', () => {
  test('renders the bento setup cards and first step copy', () => {
    const html = htmlFor(<FirstRunWizard />);
    expect(html).toContain('First-run setup');
    expect(html).toContain('Oracle memory layer');
    expect(html).toContain('Local backend default');
    expect(html).toContain('No provider prompt is required');
    expect(html).toContain('Collections to create');
    expect(html).toContain('Start initial indexing');
  });

  test('reads the setup-complete flag from localStorage', () => {
    const restore = installBrowserLocation('/setup');
    try {
      window.localStorage.setItem(FIRST_RUN_COMPLETE_KEY, '1');
      expect(htmlFor(<FirstRunProbe />)).toContain('complete:hide');
    } finally {
      restore();
    }
  });
});
