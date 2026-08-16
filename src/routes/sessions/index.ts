import { Elysia } from 'elysia';
import { sessionsReadRoutes } from './read.ts';
import { summaryRoute } from './summary.ts';

export const sessionsRoutes = new Elysia().use(sessionsReadRoutes).use(summaryRoute);
