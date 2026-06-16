import { Elysia, t } from 'elysia';
import { thorOracleProfile } from '../../oracles/thor.ts';

const ThorCapabilitySchema = t.Object({
  id: t.String(),
  label: t.String(),
  description: t.String(),
});

const ThorProfileSchema = t.Object({
  id: t.String(),
  name: t.String(),
  role: t.String(),
  theme: t.String(),
  born: t.String(),
  motto: t.String(),
  principles: t.Array(t.String()),
  capabilities: t.Array(ThorCapabilitySchema),
  workflows: t.Array(t.String()),
});

export const thorOracleEndpoint = new Elysia().get('/oracles/thor', () => thorOracleProfile, {
  response: ThorProfileSchema,
  detail: {
    tags: ['health'],
    menu: { group: 'hidden' },
    description: 'Returns the Thor Oracle dev/research awakening profile and Stormforge capabilities.',
    summary: 'Thor Oracle dev/research profile',
  },
});
