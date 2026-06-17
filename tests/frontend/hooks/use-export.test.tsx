import { describe, expect, test } from 'bun:test';
import { useExport } from '../../../frontend/src/hooks/useExport';
import { htmlFor } from '../_render';

function ExportProbe() {
  const state = useExport({ fetcher: undefined, pollMs: 1 });
  return (
    <span>
      {state.status}:{state.progress}:{String(state.jobId)}:{typeof state.start}:{typeof state.retry}:{typeof state.reset}
    </span>
  );
}

describe('useExport hook state store', () => {
  test('exposes an idle initial state with export actions', () => {
    const html = htmlFor(<ExportProbe />);

    expect(html).toContain('idle:0:null:function:function:function');
  });
});
