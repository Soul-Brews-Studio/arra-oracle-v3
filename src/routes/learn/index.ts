import { Elysia } from 'elysia';
import { createLearnCrudRoutes } from './crud.ts';
import { createLearnListRoutes } from './list.ts';

export const learnRoutes = new Elysia({ prefix: '/api' }).use(createLearnListRoutes()).use(createLearnCrudRoutes());
export { createLearnCrudRoutes } from './crud.ts';
export { createLearnListRoutes } from './list.ts';
