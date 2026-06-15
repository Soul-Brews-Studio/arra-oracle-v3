import { Elysia } from 'elysia';
import { createLearnCrudRoutes } from './crud.ts';

export const learnRoutes = new Elysia({ prefix: '/api' }).use(createLearnCrudRoutes());
export { createLearnCrudRoutes } from './crud.ts';
