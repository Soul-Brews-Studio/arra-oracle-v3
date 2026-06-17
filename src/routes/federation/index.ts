import { Elysia, t } from 'elysia';
import {
  createDefaultFederationProvider,
  FederationCapabilityProvider,
  type MeshNodeInput,
} from '../../federation/capability-provider.ts';

const MeshNodeBody = t.Object({
  id: t.Optional(t.String()),
  name: t.Optional(t.String()),
  url: t.String({ minLength: 1 }),
  capabilities: t.Optional(t.Array(t.String())),
  metadata: t.Optional(t.Record(t.String(), t.Unknown())),
  status: t.Optional(t.Union([t.Literal('active'), t.Literal('disabled')])),
});

function failure(error: unknown, set: { status?: unknown }) {
  set.status = 400;
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function createFederationRoutes(
  provider: FederationCapabilityProvider = createDefaultFederationProvider(),
) {
  return new Elysia({ prefix: '/api/federation' })
    .get('/status', () => provider.status(), {
      detail: { tags: ['federation'], summary: 'Federation capability provider status' },
    })
    .get('/capabilities', () => ({
      capabilities: provider.capabilities(),
      nodes: provider.listNodes().length,
    }), {
      detail: { tags: ['federation'], summary: 'List active federation capabilities' },
    })
    .get('/mesh/nodes', () => {
      const nodes = provider.listNodes();
      return { count: nodes.length, nodes };
    }, {
      detail: { tags: ['federation'], summary: 'List registered mesh nodes' },
    })
    .post('/mesh/nodes/register', ({ body, set }) => {
      try {
        return {
          success: true,
          node: provider.registerNode(body as MeshNodeInput),
        };
      } catch (error) {
        return failure(error, set);
      }
    }, {
      body: MeshNodeBody,
      detail: { tags: ['federation'], summary: 'Register or update one federation mesh node' },
    });
}

export const federationRoutes = createFederationRoutes();
