import { Elysia } from 'elysia';
import { SESSION_COOKIE_NAME, isAuthenticated } from '../auth/index.ts';
import { getSettingsRoute } from './get.ts';
import { updateSettingsRoute } from './update.ts';
import { toolSettingsRoute } from './tools.ts';

export const settingsRoutes = new Elysia({ prefix: '/api/settings' })
  .onBeforeHandle(({ server, request, cookie, set }) => {
    const sessionValue = cookie[SESSION_COOKIE_NAME]?.value as string | undefined;
    if (!isAuthenticated(server, request, sessionValue)) {
      set.status = 401;
      return { error: 'Unauthorized', requiresAuth: true };
    }
  })
  .use(getSettingsRoute)
  .use(updateSettingsRoute)
  .use(toolSettingsRoute);

export * from './model.ts';
