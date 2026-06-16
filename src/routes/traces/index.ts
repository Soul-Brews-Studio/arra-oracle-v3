import { Elysia } from 'elysia';
import { tracesListRoute } from './list.ts';
import { traceGetRoute } from './get.ts';
import { traceChainRoute } from './chain.ts';
import { traceLinkRoute } from './link.ts';
import { traceUnlinkRoute } from './unlink.ts';
import { traceLinkedChainRoute } from './linked-chain.ts';
import { traceDistillRoute } from './distill.ts';

export const tracesApi = new Elysia()
  .use(tracesListRoute)
  .use(traceGetRoute)
  .use(traceChainRoute)
  .use(traceLinkRoute)
  .use(traceUnlinkRoute)
  .use(traceLinkedChainRoute)
  .use(traceDistillRoute);
