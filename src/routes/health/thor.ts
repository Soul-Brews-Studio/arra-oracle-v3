import { Elysia } from 'elysia';
import { thorOracleProfile } from '../../oracles/thor.ts';
import { oracleProfileSchema } from './oracle-profiles.ts';
import { withEnvelope } from '../response-envelope.ts';

export function createThorOracleEndpoint() {
  return new Elysia().get('/oracles/thor', () => thorOracleProfile, {
    response: withEnvelope(oracleProfileSchema()),
    detail: {
      tags: ['health'],
      menu: { group: 'hidden' },
      description: 'Returns the Thor Oracle dev/research awakening profile and Stormforge capabilities.',
      summary: 'Thor Oracle dev/research profile',
    },
  });
}
