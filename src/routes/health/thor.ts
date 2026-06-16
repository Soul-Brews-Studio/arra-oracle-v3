import { Elysia } from 'elysia';
import { thorOracleProfile } from '../../oracles/thor.ts';
import { OracleProfileSchema } from './oracle-profiles.ts';

export const thorOracleEndpoint = new Elysia().get('/oracles/thor', () => thorOracleProfile, {
  response: OracleProfileSchema,
  detail: {
    tags: ['health'],
    menu: { group: 'hidden' },
    description: 'Returns the Thor Oracle dev/research awakening profile and Stormforge capabilities.',
    summary: 'Thor Oracle dev/research profile',
  },
});
