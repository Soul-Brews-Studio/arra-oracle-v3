import { Elysia } from 'elysia';
import { getSetting, isDbLockError } from '../../db/index.ts';
import { activeTenantId } from '../../middleware/tenant.ts';
import {
  SESSION_COOKIE_NAME,
  isAuthenticated,
  isLocalNetwork,
} from './index.ts';

export const statusRoute = new Elysia().get('/status', ({ server, request, cookie }) => {
  const sessionValue = cookie[SESSION_COOKIE_NAME]?.value as string | undefined;
  try {
    const authEnabled = getSetting('auth_enabled') === 'true';
    const hasPassword = !!getSetting('auth_password_hash');
    const localBypass = getSetting('auth_local_bypass') !== 'false';
    const isLocal = isLocalNetwork(server, request);
    const authenticated = isAuthenticated(server, request, sessionValue);
    const tenantId = activeTenantId();

    return { authenticated, authEnabled, hasPassword, localBypass, isLocal, tenantId };
  } catch (err) {
    if (isDbLockError(err)) {
      return {
        authenticated: false,
        authEnabled: false,
        hasPassword: false,
        localBypass: true,
        isLocal: true,
        tenantId: activeTenantId(),
        indexing: true,
      };
    }
    throw err;
  }
}, {
  detail: {
    tags: ['auth'],
    menu: { group: 'hidden' },
    summary: 'Current auth + session state',
  },
});
