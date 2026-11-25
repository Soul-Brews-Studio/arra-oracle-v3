/** GET /instructions — plain-text agent guide (#3110). Text for every client, browsers included. */
import { Elysia } from 'elysia';
import { instructionsText } from './text.ts';

export function createInstructionsRoutes(version: string, dir?: string) {
  return new Elysia().get('/instructions', ({ request }) => {
    const origin = new URL(request.url).origin;
    return new Response(instructionsText(origin, version, dir), {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' },
    });
  }, { detail: { tags: ['meta'], summary: 'Plain-text guide for agents: how to connect, work, and join this hub' } });
}
