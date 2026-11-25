/** Hub UI pages render (#3110): owner sees nodes with masked addresses and revoke; a visitor gets "owner only". */
import { describe, expect, test } from 'bun:test';
import { htmlFor } from '../_render';
import type { HubApi, HubNodeRow } from '../../../frontend/src/hub/api';
import { NodesView } from '../../../frontend/src/hub/NodesView';
import { StatusView } from '../../../frontend/src/hub/StatusView';
import { InviteView } from '../../../frontend/src/hub/InviteView';
import { OwnerOnly } from '../../../frontend/src/hub/ui';

const api = {} as HubApi;
const node = (id: string, state: HubNodeRow['state']): HubNodeRow => ({
  id, label: id.split('-')[0], url: null, joinedAt: '2026-11-25T00:00:00Z', expiresAt: '2026-11-26T00:00:00Z',
  lastSeenAt: '2026-11-25T00:00:00Z', lastIp: '100.111.101.21', calls: 3, status: state === 'revoked' ? 'revoked' : 'active', state, left: '23h',
});

describe('hub UI render', () => {
  test('nodes table shows every state, masks addresses, revoke only on live rows', () => {
    const html = htmlFor(<NodesView api={api} nodes={[node('a-1', 'active'), node('b-2', 'expired'), node('c-3', 'revoked')]} invites={[]} onChange={() => {}} showIps={false} />);
    for (const s of ['active', 'expired', 'revoked']) expect(html).toContain(`>${s}<`);
    expect(html).toContain('100.x.x.x');
    expect(html).not.toContain('100.111.101.21');
    expect(html.match(/>Revoke</g)?.length).toBe(2);
  });
  test('visitor status shows only the public hub card', () => {
    const html = htmlFor(<StatusView status={null} publicHub={{ hub: 'soul-brews', sha: 'abcdef123', nodes: 2 }} />);
    expect(html).toContain('soul-brews');
    expect(html).toContain('abcdef1');
    expect(html).toContain('owner only');
  });
  test('invite offers the four --for grants', () => {
    const html = htmlFor(<InviteView api={api} onChange={() => {}} />);
    for (const g of ['15m', '1h', '7d', 'forever']) expect(html).toContain(`>${g}<`);
  });
  test('owner-only panel names the loopback address', () => {
    expect(htmlFor(<OwnerOnly what="Nodes" />)).toContain('127.0.0.1');
  });
});
