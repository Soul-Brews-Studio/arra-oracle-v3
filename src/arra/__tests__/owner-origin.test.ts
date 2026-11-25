/** Owner API from a browser: a loopback page may call it, a website in the owner's browser may not. */
import { describe, expect, test } from 'bun:test';
import { PEER_IP_HEADER } from '../net.ts';
import { isOwnerRequest } from '../../routes/arra/guard.ts';

const req = (ip: string, origin?: string) =>
  new Request('http://local/api/arra/hub/invite', { headers: { [PEER_IP_HEADER]: ip, ...(origin ? { origin } : {}) } });

describe('isOwnerRequest', () => {
  test('loopback without Origin (CLI, MCP, skills) is the owner', () => {
    expect(isOwnerRequest(req('127.0.0.1'))).toBe(true);
    expect(isOwnerRequest(req('::1'))).toBe(true);
  });
  test('the hub UI on a loopback page is the owner', () => {
    expect(isOwnerRequest(req('127.0.0.1', 'http://127.0.0.1:47778'))).toBe(true);
    expect(isOwnerRequest(req('127.0.0.1', 'http://localhost:3000'))).toBe(true);
    expect(isOwnerRequest(req('::1', 'http://[::1]:47778'))).toBe(true);
  });
  test('a website open in the owner browser is not', () => {
    expect(isOwnerRequest(req('127.0.0.1', 'https://studio.buildwithoracle.com'))).toBe(false);
    expect(isOwnerRequest(req('127.0.0.1', 'http://evil.example'))).toBe(false);
    expect(isOwnerRequest(req('127.0.0.1', 'null'))).toBe(false);
  });
  test('a tailnet peer is never the owner, whatever its Origin', () => {
    expect(isOwnerRequest(req('100.64.0.9'))).toBe(false);
    expect(isOwnerRequest(req('100.64.0.9', 'http://127.0.0.1:47778'))).toBe(false);
  });
});
