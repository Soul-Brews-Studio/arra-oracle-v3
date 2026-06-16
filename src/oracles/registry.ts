import { thorOracleProfile } from './thor.ts';
import type { OracleProfile } from './model.ts';

const profiles = [thorOracleProfile] as const satisfies readonly OracleProfile[];

function key(value: string): string {
  return value.trim().toLowerCase();
}

export function listOracleProfiles(): OracleProfile[] {
  return [...profiles];
}

export function getOracleProfile(slugOrId: string): OracleProfile | undefined {
  const requested = key(slugOrId);
  return profiles.find((profile) => [
    profile.id,
    profile.slug,
    profile.name,
    profile.name.replace(/\s+oracle$/i, ''),
  ].map(key).includes(requested));
}
