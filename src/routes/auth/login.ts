import { Elysia } from 'elysia';
import { getScopedSetting } from '../../db/scoped-settings.ts';
import {
  SESSION_COOKIE_NAME,
  SESSION_DURATION_MS,
  generateSessionToken,
  isLocalNetwork,
  passwordMatches,
  usablePassword,
} from './index.ts';
import { LoginBody } from './model.ts';

export const loginRoute = new Elysia().post('/login', async ({ body, server, request, cookie, set }) => {
  const password = usablePassword(body.password);
  if (!password) {
    set.status = 400;
    return { success: false, error: 'Password required' };
  }

  const storedHash = getScopedSetting('auth_password_hash');
  if (!storedHash) {
    set.status = 400;
    return { success: false, error: 'No password configured' };
  }

  const valid = await passwordMatches(password, storedHash);
  if (!valid) {
    set.status = 401;
    return { success: false, error: 'Invalid password' };
  }

  const token = generateSessionToken();
  const isLocal = isLocalNetwork(server, request);
  cookie[SESSION_COOKIE_NAME].set({
    value: token,
    httpOnly: true,
    secure: !isLocal,
    sameSite: 'lax',
    maxAge: SESSION_DURATION_MS / 1000,
    path: '/',
  });

  return { success: true };
}, {
  body: LoginBody,
  detail: {
    tags: ['auth'],
    menu: { group: 'hidden' },
    summary: 'Authenticate with password',
  },
});
