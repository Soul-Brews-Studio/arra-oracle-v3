import { describe, expect, test } from 'bun:test';
import { getOracleProfile, listOracleProfiles } from '../../src/oracles/registry.ts';

describe('oracle registry edge cases', () => {
  test('matches normalized dash, underscore, whitespace, and NFKC aliases', () => {
    expect(getOracleProfile(' THOR_ORACLE ')?.slug).toBe('thor');
    expect(getOracleProfile(' thor---oracle ')?.slug).toBe('thor');
    expect(getOracleProfile('ＴＨＯＲ')?.id).toBe('thor-oracle');
    expect(getOracleProfile('Thor\tOracle')?.id).toBe('thor-oracle');
  });

  test('returns independent defensive copies for repeated profile reads', () => {
    const first = getOracleProfile('thor')!;
    const second = getOracleProfile('thor')!;

    first.principles.push('mutated');
    first.capabilities[0].description = 'mutated';

    expect(second.principles).not.toContain('mutated');
    expect(second.capabilities[0].description).toContain('Convert traces');
  });

  test('list results stay detached from later lookups', () => {
    const listed = listOracleProfiles()[0];
    listed.defaultConcepts.length = 0;

    expect(getOracleProfile('thor')?.defaultConcepts).toContain('thor-oracle');
  });
});
