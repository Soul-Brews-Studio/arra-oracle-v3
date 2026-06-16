import { describe, expect, it } from 'bun:test';
import { handleOracleProfile } from '../oracle.ts';

function payload(result: ReturnType<typeof handleOracleProfile>) {
  return JSON.parse(result.content[0]!.text);
}

describe('oracle profile MCP handler', () => {
  it('lists Thor Oracle through the registry', () => {
    const body = payload(handleOracleProfile({}));
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.profiles.map((profile: { slug: string }) => profile.slug)).toContain('thor');
  });

  it('reads Thor by id', () => {
    const body = payload(handleOracleProfile({ id: 'thor-oracle' }));
    expect(body.id).toBe('thor-oracle');
    expect(body.defaultConcepts).toContain('stormforge');
  });
});
