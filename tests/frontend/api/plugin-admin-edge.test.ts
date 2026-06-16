import { describe, expect, test } from 'bun:test';
import { setPluginEnabled } from '../../../frontend/src/api/plugin-admin';
import { installFetch, jsonResponse } from './_fetch';

describe('plugin admin API edge cases', () => {
  test('encodes plugin names and sends a JSON state patch', async () => {
    const fetchMock = installFetch(() => jsonResponse({ ok: true, plugin: 'echo/tools', enabled: false, requiresRestart: true, message: 'updated' }));
    try {
      await expect(setPluginEnabled('echo/tools', false)).resolves.toMatchObject({ plugin: 'echo/tools', enabled: false });
      expect(fetchMock.calls[0]?.input).toBe('/api/plugins/echo%2Ftools/state');
      expect(fetchMock.calls[0]?.init?.method).toBe('PATCH');
      expect(new Headers(fetchMock.calls[0]?.init?.headers).get('content-type')).toBe('application/json');
      expect(fetchMock.calls[0]?.init?.body).toBe(JSON.stringify({ enabled: false }));
    } finally {
      fetchMock.restore();
    }
  });

  test('falls back to HTTP status text when backend errors are not strings', async () => {
    const fetchMock = installFetch(() => jsonResponse({ error: { code: 'disabled' } }, { status: 409, statusText: 'Conflict' }));
    try {
      await expect(setPluginEnabled('echo', true)).rejects.toThrow('/api/plugins/echo/state returned 409: Conflict');
    } finally {
      fetchMock.restore();
    }
  });
});
