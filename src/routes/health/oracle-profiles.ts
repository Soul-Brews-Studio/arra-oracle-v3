import { Elysia, t } from 'elysia';
import { getOracleProfile, listOracleProfiles } from '../../oracles/registry.ts';

export const OracleCapabilitySchema = t.Object({
  id: t.String(),
  label: t.String(),
  description: t.String(),
});

export const OracleProfileSchema = t.Object({
  id: t.String(),
  slug: t.String(),
  name: t.String(),
  role: t.String(),
  theme: t.String(),
  born: t.String(),
  human: t.Optional(t.String()),
  motto: t.String(),
  principles: t.Array(t.String()),
  capabilities: t.Array(OracleCapabilitySchema),
  workflows: t.Array(t.String()),
  defaultConcepts: t.Array(t.String()),
});

const ProfilesResponseSchema = t.Object({
  profiles: t.Array(OracleProfileSchema),
  total: t.Number(),
});

export const oracleProfilesEndpoint = new Elysia()
  .get('/oracles/profiles', () => {
    const profiles = listOracleProfiles();
    return { profiles, total: profiles.length };
  }, {
    response: ProfilesResponseSchema,
    detail: {
      tags: ['health'],
      menu: { group: 'hidden' },
      summary: 'List code-backed Oracle profiles',
    },
  })
  .get('/oracles/profiles/:slug', ({ params, set }) => {
    const profile = getOracleProfile(params.slug);
    if (!profile) {
      set.status = 404;
      return { error: 'Oracle profile not found' };
    }
    return profile;
  }, {
    params: t.Object({ slug: t.String() }),
    response: t.Union([OracleProfileSchema, t.Object({ error: t.String() })]),
    detail: {
      tags: ['health'],
      menu: { group: 'hidden' },
      summary: 'Read one code-backed Oracle profile',
    },
  });
