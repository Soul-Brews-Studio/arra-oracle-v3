import { describe, expect, test } from 'bun:test';
import {
  FederationCapabilityProvider,
  createDefaultFederationProvider,
} from '../capability-provider.ts';

const fixedClock = () => new Date('2026-06-17T00:00:00.000Z');

describe('FederationCapabilityProvider', () => {
  test('registers normalized mesh nodes and aggregates active capabilities', () => {
    const provider = new FederationCapabilityProvider({ clock: fixedClock });
    const node = provider.registerNode({
      id: ' EDGE-1 ',
      name: 'Edge relay',
      url: 'https://relay.example.test/root/?secret=1#frag',
      capabilities: ['Maw:Hey', 'maw:peek', 'maw:hey'],
      metadata: { role: 'relay', '': 'drop' },
    });

    expect(node).toMatchObject({
      id: 'edge-1',
      name: 'Edge relay',
      url: 'https://relay.example.test/root',
      capabilities: ['maw:hey', 'maw:peek'],
      metadata: { role: 'relay' },
      status: 'active',
      registeredAt: '2026-06-17T00:00:00.000Z',
      updatedAt: '2026-06-17T00:00:00.000Z',
    });
    expect(provider.status()).toMatchObject({
      nodes: 1,
      activeNodes: 1,
      capabilities: ['maw:hey', 'maw:peek'],
    });
  });

  test('updates an existing node while preserving registration time', () => {
    let now = new Date('2026-06-17T00:00:00.000Z');
    const provider = new FederationCapabilityProvider({ clock: () => now });
    provider.registerNode({ id: 'node-a', url: 'http://127.0.0.1:3456', capabilities: ['maw:hey'] });
    now = new Date('2026-06-17T01:00:00.000Z');

    const updated = provider.registerNode({
      id: 'node-a',
      url: 'http://127.0.0.1:3457/',
      capabilities: ['federation:status'],
      status: 'disabled',
    });

    expect(updated.registeredAt).toBe('2026-06-17T00:00:00.000Z');
    expect(updated.updatedAt).toBe('2026-06-17T01:00:00.000Z');
    expect(provider.status()).toMatchObject({ nodes: 1, activeNodes: 0, capabilities: [] });
  });

  test('rejects unsafe identifiers, endpoints, and capability names', () => {
    const provider = new FederationCapabilityProvider();
    expect(() => provider.registerNode({ id: '../bad', url: 'https://node.example' })).toThrow('mesh node id');
    expect(() => provider.registerNode({ id: 'good', url: 'file:///tmp/node' })).toThrow('http(s)');
    expect(() => provider.registerNode({
      id: 'good',
      url: 'https://node.example',
      capabilities: ['bad space'],
    })).toThrow('invalid federation capability');
  });

  test('creates a local backend node from runtime env defaults', () => {
    const provider = createDefaultFederationProvider({
      ORACLE_HTTP_URL: ' https://oracle.example/api?drop=1 ',
    });

    expect(provider.listNodes()[0]).toMatchObject({
      id: 'local-oracle',
      url: 'https://oracle.example/api',
      metadata: { role: 'backend', source: 'maw-arra-plugin' },
    });
    expect(provider.capabilities()).toContain('federation:mesh-register');
    expect(provider.capabilities()).toContain('vector:proxy');
  });
});
