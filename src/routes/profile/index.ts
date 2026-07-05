import { Elysia, t } from 'elysia';
import { getOracleProfile, listOracleProfiles } from '../../oracles/registry.ts';
import type { OracleProfile } from '../../oracles/model.ts';

function oracleCapabilitySchema() {
  return t.Object({
    id: t.String(),
    label: t.String(),
    description: t.String(),
  });
}

export function oracleProfileSchema() {
  return t.Object({
    id: t.String(),
    slug: t.String(),
    name: t.String(),
    role: t.String(),
    theme: t.String(),
    born: t.String(),
    human: t.Optional(t.String()),
    motto: t.String(),
    principles: t.Array(t.String()),
    capabilities: t.Array(oracleCapabilitySchema()),
    workflows: t.Array(t.String()),
    defaultConcepts: t.Array(t.String()),
  });
}

function profileChoice(profile: OracleProfile) {
  return { id: profile.id, slug: profile.slug, name: profile.name };
}

function sortedProfiles(): OracleProfile[] {
  return listOracleProfiles().sort((left, right) => left.slug.localeCompare(right.slug));
}

function profilesResponseSchema() {
  return t.Object({ profiles: t.Array(oracleProfileSchema()), total: t.Number() });
}

const notFoundSchema = t.Object({
  error: t.String(),
  requested: t.String(),
  profiles: t.Array(t.Object({ id: t.String(), slug: t.String(), name: t.String() })),
});

export function createOracleProfilesEndpoint() {
  return new Elysia()
    .get('/oracles/profiles', () => {
      const profiles = sortedProfiles();
      return { profiles, total: profiles.length };
    }, {
      response: profilesResponseSchema(),
      detail: { tags: ['health'], menu: { group: 'hidden' }, summary: 'List code-backed Oracle profiles' },
    })
    .get('/oracles/profiles/:slug', ({ params, set }) => {
      const requested = params.slug.trim();
      const profile = getOracleProfile(requested);
      if (!profile) {
        set.status = 404;
        return { error: 'Oracle profile not found', requested: params.slug, profiles: sortedProfiles().map(profileChoice) };
      }
      return profile;
    }, {
      params: t.Object({ slug: t.String({ minLength: 1 }) }),
      response: t.Union([oracleProfileSchema(), notFoundSchema]),
      detail: { tags: ['health'], menu: { group: 'hidden' }, summary: 'Read one code-backed Oracle profile' },
    });
}
