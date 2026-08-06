import { afterEach, describe, expect, test } from 'bun:test';
import { AddMemory, AddMemoryFeedback, ADD_MEMORY_ENDPOINT, SAVE_CONFIRMATION_MS, postSimpleMemory, saveSimpleMemory, simpleMemoryPayload } from '../../../frontend/src/components/simple/AddMemory';
import { htmlFor } from '../_render';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function pathFor(input: RequestInfo | URL): string {
  return new URL(String(input)).pathname;
}

describe('AddMemory simple mode card', () => {
  test('renders the simple textarea, full-width save pill, and live saved region', () => {
    const html = htmlFor(<AddMemory />);

    expect(html).toContain('Save something to memory');
    expect(html).toContain('textarea');
    expect(html).toContain('w-full rounded-full');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="status"');
    expect(SAVE_CONFIRMATION_MS).toBe(3000);
  });

  test('builds the Simple Mode learn payload and rejects blank memories', async () => {
    expect(simpleMemoryPayload('  Remember the blue mug.  ')).toEqual({
      pattern: 'Remember the blue mug.',
      source: 'Simple Mode',
    });
    await expect(saveSimpleMemory('   ', async () => {})).rejects.toThrow('Memory text is required.');
  });

  test('posts saved memories to the versioned learn endpoint', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = (async (input, init) => {
      calls.push({ input, init });
      return Response.json({ success: true, id: 'simple-memory', file: 'ψ/memory/learnings/simple-memory.md' });
    }) as typeof fetch;

    await expect(postSimpleMemory(simpleMemoryPayload('Keep the receipt.'))).resolves.toMatchObject({ success: true, id: 'simple-memory' });

    expect(calls).toHaveLength(1);
    expect(pathFor(calls[0].input)).toBe(ADD_MEMORY_ENDPOINT);
    expect(calls[0].init?.method).toBe('POST');
    expect(new Headers(calls[0].init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ pattern: 'Keep the receipt.', source: 'Simple Mode' });
  });

  test('renders save errors with a Retry action', () => {
    const html = htmlFor(<AddMemoryFeedback status="error" error="offline" fading={false} saving={false} onRetry={() => {}} />);

    expect(html).toContain('role="alert"');
    expect(html).toContain('Couldn’t save memory.');
    expect(html).toContain('offline');
    expect(html).toContain('Retry');
  });
});
