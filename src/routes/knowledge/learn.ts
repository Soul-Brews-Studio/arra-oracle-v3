/**
 * POST /api/learn — record a learning pattern.
 */

import { Elysia } from 'elysia';
import { normalizeLearningPattern } from '../../learn/markdown.ts';
import { handleLearn } from '../../server/handlers.ts';
import { LearnBody } from './model.ts';

export const learnEndpoint = new Elysia()
  .post(
    '/learn',
    ({ body, set }) => {
      try {
        const data = (body ?? {}) as Record<string, any>;
        let pattern: string;
        try {
          pattern = normalizeLearningPattern(data.pattern);
        } catch {
          set.status = 400;
          return { error: 'Missing required field: pattern' };
        }
        return handleLearn(
          pattern,
          data.source,
          data.concepts,
          data.origin,
          data.project,
          data.cwd,
        );
      } catch (error) {
        set.status = 500;
        return { error: error instanceof Error ? error.message : 'Unknown error' };
      }
    },
    {
      body: LearnBody,
      detail: {
        tags: ['knowledge'],
        menu: { group: 'hidden' },
        summary: 'Record a learning pattern',
      },
    },
  );
