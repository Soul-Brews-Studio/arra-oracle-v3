import { expect, test } from 'bun:test';
import { buildIssueUrl, parseIssueUrl } from '../../src/forum/types.ts';

test('parseIssueUrl accepts only canonical GitHub issue URLs', () => {
  expect(parseIssueUrl('https://github.com/Owner/Repo/issues/123')).toMatchObject({
    owner: 'Owner',
    repo: 'Repo',
    issueNumber: 123,
  });
  expect(parseIssueUrl('https://evil.test/github.com/owner/repo/issues/1')).toBeNull();
  expect(parseIssueUrl('https://github.com/owner/repo/issues/1/comments')).toBeNull();
  expect(parseIssueUrl('https://github.com/owner/repo/pull/1')).toBeNull();
  expect(parseIssueUrl('ftp://github.com/owner/repo/issues/1')).toBeNull();
  expect(parseIssueUrl('https://github.com/owner/repo/issues/0')).toBeNull();
});

test('buildIssueUrl encodes path parts and rejects invalid issue numbers', () => {
  expect(buildIssueUrl('owner name', 'repo name', 3))
    .toBe('https://github.com/owner%20name/repo%20name/issues/3');
  expect(() => buildIssueUrl('', 'repo', 1)).toThrow('owner must not be blank');
  expect(() => buildIssueUrl('owner', 'repo', 0)).toThrow('issueNumber must be a positive safe integer');
});
