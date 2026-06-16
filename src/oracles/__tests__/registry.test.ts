import { describe, expect, test } from 'bun:test';
import { getOracleProfile, listOracleProfiles } from '../registry.ts';

describe('oracle profile registry edge handling', () => {
  test('matches Thor by trimmed/case-insensitive id, slug, name, and short name', () => {
    expect(getOracleProfile(' THOR-ORACLE ')?.slug).toBe('thor');
    expect(getOracleProfile('thor')?.id).toBe('thor-oracle');
    expect(getOracleProfile('ThOr OrAcLe')?.theme).toBe('stormforge');
    expect(getOracleProfile('thor')?.name).toBe('Thor Oracle');
  });

  test('returns undefined for empty or non-string lookups', () => {
    expect(getOracleProfile('   ')).toBeUndefined();
    expect(getOracleProfile(undefined)).toBeUndefined();
  });

  test('returns defensive profile copies so callers cannot mutate the registry', () => {
    const listed = listOracleProfiles();
    listed[0].principles.push('mutated');
    listed[0].capabilities[0].label = 'Mutated';

    const fresh = getOracleProfile('thor')!;
    expect(fresh.principles).not.toContain('mutated');
    expect(fresh.capabilities[0].label).toBe('Research distillation');
  });
});
