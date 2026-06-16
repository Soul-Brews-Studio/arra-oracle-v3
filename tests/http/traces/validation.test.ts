import { describe, expect, test } from 'bun:test';
import { traceLinkRoute } from '../../../src/routes/traces/link.ts';
import { traceUnlinkRoute } from '../../../src/routes/traces/unlink.ts';

function postLink(body: unknown) {
  return traceLinkRoute.handle(new Request('http://local/api/traces/a/link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

function deleteLink(query = '') {
  return traceUnlinkRoute.handle(new Request(`http://local/api/traces/a/link${query}`, {
    method: 'DELETE',
  }));
}

describe('trace link route input validation', () => {
  test('rejects missing or non-string nextId before link handling', async () => {
    expect((await postLink({})).status).toBe(422);
    expect((await postLink({ nextId: 42 })).status).toBe(422);
  });

  test('rejects unlink directions outside the prev|next allowlist', async () => {
    expect((await deleteLink()).status).toBe(400);
    expect((await deleteLink('?direction=sideways')).status).toBe(422);
  });
});
