/** Spaces (#3110): the Studio switcher's filter — this machine, the owned hub, joined hubs. */
import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { filterBySpace, listSpaces, parseSpace } from '../space.ts';

const db = () => {
  const d = new Database(':memory:');
  d.run('CREATE TABLE oracle_documents (id TEXT PRIMARY KEY, origin TEXT, superseded_by TEXT)');
  for (const [id, origin] of [['mine-1', null], ['mine-2', 'human'], ['hub-a', 'hub:soul-brews'], ['hub-b', 'hub:soul-brews'], ['own-1', 'hub:vault']] as const) {
    d.run('INSERT INTO oracle_documents (id, origin) VALUES (?, ?)', [id, origin]);
  }
  return d;
};

describe('spaces', () => {
  test('parse: self, hub:<name>, nothing = all; anything else is refused', () => {
    expect(parseSpace(undefined)).toBeNull();
    expect(parseSpace('all')).toBeNull();
    expect(parseSpace('self')).toBe('self');
    expect(parseSpace('hub:soul-brews')).toBe('hub:soul-brews');
    expect(() => parseSpace("hub:x' OR 1=1")).toThrow('space must be');
  });
  test('filter keeps only rows of that space; unknown ids drop', () => {
    const rows = [{ id: 'mine-1' }, { id: 'hub-a' }, { id: 'mine-2' }, { id: 'nope' }, { id: 'hub-b' }];
    expect(filterBySpace(db(), rows, 'self').map((r) => r.id)).toEqual(['mine-1', 'mine-2']);
    expect(filterBySpace(db(), rows, 'hub:soul-brews').map((r) => r.id)).toEqual(['hub-a', 'hub-b']);
  });
  test('list: this machine first, then the owned hub (its vault), then joined hubs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-space-'));
    fs.writeFileSync(path.join(dir, 'arra.json'), JSON.stringify({ version: 1, name: 'm5', vaults: [{ name: 'vault', path: '/x' }], hub: { name: 'home' } }));
    fs.writeFileSync(path.join(dir, 'hubs.json'), JSON.stringify([{ name: 'soul-brews', url: 'http://h', nodeId: 'n', token: 't', joinedAt: '2026-01-01', expiresAt: null }]));
    const s = listSpaces(db(), dir);
    expect(s.map((x) => [x.id, x.role, x.docs])).toEqual([['self', 'self', 2], ['hub:vault', 'owner', 1], ['hub:soul-brews', 'joined', 2]]);
    expect(s[1].label).toBe('hub:home');
    expect(JSON.stringify(s)).not.toContain('"token"');
  });
});
