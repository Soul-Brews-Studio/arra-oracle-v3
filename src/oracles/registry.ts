import { thorOracleProfile } from './thor.ts';
import type { OracleProfile } from './model.ts';

const profiles = [thorOracleProfile] as const satisfies readonly OracleProfile[];

function key(value: string): string {
  return value.trim().toLowerCase();
}

function cloneProfile(profile: OracleProfile): OracleProfile {
  return {
    ...profile,
    principles: [...profile.principles],
    capabilities: profile.capabilities.map((capability) => ({ ...capability })),
    workflows: [...profile.workflows],
    defaultConcepts: [...profile.defaultConcepts],
  };
}

function aliases(profile: OracleProfile): string[] {
  return [
    profile.id,
    profile.slug,
    profile.name,
    profile.name.replace(/\s+oracle$/i, ''),
  ];
}

export function listOracleProfiles(): OracleProfile[] {
  return profiles.map(cloneProfile);
}

export function getOracleProfile(slugOrId: unknown): OracleProfile | undefined {
  if (typeof slugOrId !== 'string') return undefined;
  const requested = key(slugOrId);
  if (!requested) return undefined;
  const profile = profiles.find((item) => aliases(item).map(key).includes(requested));
  return profile ? cloneProfile(profile) : undefined;
}
