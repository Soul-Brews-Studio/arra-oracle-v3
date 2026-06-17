export type MeshNodeStatus = 'active' | 'disabled';

export interface MeshNodeInput {
  id?: string;
  name?: string;
  url: string;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
  status?: MeshNodeStatus;
}

export interface MeshNode {
  id: string;
  name: string;
  url: string;
  capabilities: string[];
  metadata: Record<string, unknown>;
  status: MeshNodeStatus;
  registeredAt: string;
  updatedAt: string;
}

export interface FederationStatus {
  ok: true;
  provider: 'arra-oracle-federation';
  nodes: number;
  activeNodes: number;
  capabilities: string[];
}

const NODE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const CAPABILITY = /^[a-z][a-z0-9._-]*(?::[a-z0-9._-]+)*$/i;

export const DEFAULT_FEDERATION_CAPABILITIES = [
  'maw:hey',
  'maw:peek',
  'federation:status',
  'federation:mesh-register',
] as const;

function normalizeId(value: string): string {
  const id = value.trim().toLowerCase();
  if (!NODE_ID.test(id)) throw new Error('mesh node id must be 1-128 letters, numbers, dot, underscore, colon, or dash');
  return id;
}

function idFromUrl(url: string): string {
  const parsed = new URL(url);
  return normalizeId(parsed.hostname.replace(/[^a-z0-9._:-]+/gi, '-').replace(/^-+|-+$/g, '') || 'mesh-node');
}

function normalizeUrl(value: string): string {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('mesh node url must be http(s)');
  url.username = '';
  url.password = '';
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
}

function normalizeCapabilities(values: readonly string[] | undefined): string[] {
  const input = values?.length ? values : DEFAULT_FEDERATION_CAPABILITIES;
  const out = new Set<string>();
  for (const value of input) {
    const capability = value.trim().toLowerCase();
    if (!CAPABILITY.test(capability)) throw new Error(`invalid federation capability: ${JSON.stringify(value)}`);
    out.add(capability);
  }
  return [...out].sort();
}

function cleanMetadata(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key.trim().length > 0),
  );
}

export class FederationCapabilityProvider {
  private readonly nodes = new Map<string, MeshNode>();
  private readonly clock: () => Date;

  constructor(options: { self?: MeshNodeInput; clock?: () => Date } = {}) {
    this.clock = options.clock ?? (() => new Date());
    if (options.self) this.registerNode(options.self);
  }

  registerNode(input: MeshNodeInput): MeshNode {
    const url = normalizeUrl(input.url);
    const id = normalizeId(input.id ?? idFromUrl(url));
    const existing = this.nodes.get(id);
    const now = this.clock().toISOString();
    const node: MeshNode = {
      id,
      name: input.name?.trim() || existing?.name || id,
      url,
      capabilities: normalizeCapabilities(input.capabilities),
      metadata: cleanMetadata(input.metadata),
      status: input.status ?? existing?.status ?? 'active',
      registeredAt: existing?.registeredAt ?? now,
      updatedAt: now,
    };
    this.nodes.set(id, node);
    return { ...node, capabilities: [...node.capabilities], metadata: { ...node.metadata } };
  }

  listNodes(): MeshNode[] {
    return [...this.nodes.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((node) => ({ ...node, capabilities: [...node.capabilities], metadata: { ...node.metadata } }));
  }

  capabilities(): string[] {
    const capabilities = new Set<string>();
    for (const node of this.nodes.values()) {
      if (node.status === 'active') for (const capability of node.capabilities) capabilities.add(capability);
    }
    return [...capabilities].sort();
  }

  status(): FederationStatus {
    const nodes = this.listNodes();
    return {
      ok: true,
      provider: 'arra-oracle-federation',
      nodes: nodes.length,
      activeNodes: nodes.filter((node) => node.status === 'active').length,
      capabilities: this.capabilities(),
    };
  }
}

export function createDefaultFederationProvider(env: Record<string, string | undefined> = process.env) {
  const port = env.ORACLE_PORT || env.PORT || '47778';
  const url = env.ORACLE_HTTP_URL || env.ORACLE_API || `http://127.0.0.1:${port}`;
  return new FederationCapabilityProvider({
    self: {
      id: 'local-oracle',
      name: 'Local Arra Oracle',
      url,
      capabilities: [...DEFAULT_FEDERATION_CAPABILITIES, 'mcp:tools', 'vector:proxy'],
      metadata: { role: 'backend', source: 'maw-arra-plugin' },
    },
  });
}
